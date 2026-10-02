import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * gate.lava.top over HTTP, for payments-backend running as a process: the
 * four operations its client calls (OpenAPI 1.22.0). Invoices it creates
 * are remembered so a test can "pay" them and send the webhook Lava would.
 */
export type FakeInvoice = {
  id: string;
  email: string;
  offerId: string;
  currency: string;
  periodicity: string | null;
  status: "NEW" | "COMPLETED" | "FAILED";
};

export class FakeLava {
  readonly invoices: FakeInvoice[] = [];
  readonly cancelled: { contractId: string; email: string }[] = [];
  private server: Server | undefined;
  url = "";

  async start(apiKey: string) {
    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : undefined;
      const url = new URL(req.url ?? "/", "http://lava.test");
      const send = (status: number, json?: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(json === undefined ? undefined : JSON.stringify(json));
      };
      if (req.headers["x-api-key"] !== apiKey) return send(401, {});

      if (req.method === "POST" && url.pathname === "/api/v3/invoice") {
        const invoice: FakeInvoice = {
          id: randomUUID(),
          email: body.email,
          offerId: body.offerId,
          currency: body.currency,
          periodicity: body.periodicity ?? null,
          status: "NEW",
        };
        this.invoices.push(invoice);
        return send(201, {
          id: invoice.id,
          status: "in-progress",
          amountTotal: { currency: invoice.currency, amount: 0.59 },
          paymentUrl: `https://app.lava.top/payment/${invoice.id}`,
        });
      }
      const one = url.pathname.match(/^\/api\/v2\/invoices\/([^/]+)$/);
      if (req.method === "GET" && one) {
        const invoice = this.invoices.find((i) => i.id === one[1]);
        return invoice ? send(200, this.view(invoice)) : send(404, {});
      }
      if (req.method === "GET" && url.pathname === "/api/v2/invoices") {
        const email = url.searchParams.get("buyerEmail");
        const items = this.invoices
          .filter((i) => !email || i.email === email)
          .map((i) => this.view(i));
        return send(200, { items, total: items.length });
      }
      if (req.method === "DELETE" && url.pathname === "/api/v1/subscriptions") {
        this.cancelled.push({
          contractId: url.searchParams.get("contractId") ?? "",
          email: url.searchParams.get("email") ?? "",
        });
        return send(204);
      }
      return send(404, {});
    });
    await new Promise<void>((resolve) =>
      this.server?.listen(0, "127.0.0.1", resolve),
    );
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** The webhook Lava sends once the buyer paid this invoice. */
  paymentSuccess(invoice: FakeInvoice, at = new Date()) {
    invoice.status = "COMPLETED";
    return {
      eventType: "payment.success",
      product: { id: invoice.offerId, title: "Battleship Premium" },
      buyer: { email: invoice.email },
      contractId: invoice.id,
      amount: 0.59,
      currency: invoice.currency,
      timestamp: at.toISOString(),
      status: invoice.periodicity ? "subscription-active" : "completed",
      errorMessage: "",
    };
  }

  private view(invoice: FakeInvoice) {
    return {
      id: invoice.id,
      type: invoice.periodicity ? "SUBSCRIPTION_FIRST_INVOICE" : "INVOICE",
      status: invoice.status,
      datetime: new Date().toISOString(),
      receipt: { amount: 0.59, currency: invoice.currency },
      buyer: { email: invoice.email },
    };
  }

  stop() {
    return new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}
