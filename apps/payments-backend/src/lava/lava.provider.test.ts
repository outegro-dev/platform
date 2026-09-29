import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LavaPaymentProvider } from "./lava.provider.js";
import {
  type CreateInvoiceInput,
  ProviderRejectedError,
  ProviderUnavailableError,
} from "./provider.js";

/**
 * The real Lava adapter against a local stub server (never the real API):
 * request shape per the saved OpenAPI 1.22.0, and the outcome mapping that
 * INV-16 depends on — a lost answer is "unknown", never "rejected".
 */

type Seen = {
  method: string;
  url: URL;
  headers: IncomingMessage["headers"];
  body: string;
};
type Handler = (req: IncomingMessage, res: ServerResponse, seen: Seen) => void;

const API_KEY = "lava-test-key-3f9a1c";
let handler: Handler = (_req, res) => res.end();
const seen: Seen[] = [];
let base = "";

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const entry = {
      method: req.method ?? "",
      url: new URL(req.url ?? "/", base),
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
    seen.push(entry);
    handler(req, res, entry);
  });
});

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const provider = (options: { timeoutMs?: number; hosts?: string[] } = {}) =>
  new LavaPaymentProvider({
    baseUrl: base,
    apiKey: API_KEY,
    timeoutMs: options.timeoutMs ?? 2_000,
    paymentUrlHosts: options.hosts ?? [],
  });

const input: CreateInvoiceInput = {
  email: "buyer@example.test",
  offerId: "3d11791f-6084-4a99-9102-4b0c362cfee8",
  currency: "RUB",
  periodicity: "ONE_TIME",
  buyerLanguage: "RU",
  returnUrls: {
    success: "https://pay.outegro.dev/checkout/result?orderId=o&result=success",
    failure: "https://pay.outegro.dev/checkout/result?orderId=o&result=failure",
    cancel: "https://pay.outegro.dev/checkout/result?orderId=o&result=cancel",
  },
};

const created = {
  id: "7ea82675-4ded-4133-95a7-a6efbaf165cc",
  status: "new",
  amountTotal: { currency: "RUB", amount: 50 },
  paymentUrl: "https://app.lava.top/pay/7ea82675",
};

/** What the adapter threw, for assertions on the class and the flags. */
async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to fail");
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
beforeEach(() => {
  seen.length = 0;
  handler = (_req, res) => res.end();
});

describe("createInvoice (POST /api/v3/invoice)", () => {
  it("sends the documented body with X-Api-Key and reads id and paymentUrl", async () => {
    handler = (_req, res) => json(res, 201, created);
    const result = await provider().createInvoice(input);
    expect(result).toEqual({
      invoiceId: created.id,
      paymentUrl: created.paymentUrl,
    });
    const [call] = seen;
    expect(call?.method).toBe("POST");
    expect(call?.url.pathname).toBe("/api/v3/invoice");
    expect(call?.headers["x-api-key"]).toBe(API_KEY);
    expect(call?.headers["content-type"]).toBe("application/json");
    expect(call?.headers.authorization).toBeUndefined();
    expect(JSON.parse(call?.body ?? "{}")).toEqual({
      email: input.email,
      offerId: input.offerId,
      currency: "RUB",
      periodicity: "ONE_TIME",
      buyerLanguage: "RU",
      successful_return_url: input.returnUrls.success,
      failure_return_url: input.returnUrls.failure,
      cancel_return_url: input.returnUrls.cancel,
    });
    // Never a client amount: the offer price at Lava is the only price sent.
    expect(JSON.parse(call?.body ?? "{}")).not.toHaveProperty("amount");
  });

  it("a 4xx is a definite rejection (nothing was created)", async () => {
    for (const status of [400, 401, 403, 404, 429]) {
      handler = (_req, res) =>
        json(res, status, { error: "Product not found", details: {} });
      const error = await failure(provider().createInvoice(input));
      expect(error).toBeInstanceOf(ProviderRejectedError);
      expect(error.message).toBe(`lava_${status}`);
    }
  });

  it("a 5xx, a 3xx or an unreadable 2xx is unknown: the invoice may exist", async () => {
    const cases: Handler[] = [
      (_req, res) => json(res, 500, { error: "boom" }),
      (_req, res) => json(res, 503, {}),
      (_req, res) => {
        res.writeHead(201, { "content-type": "text/html" });
        res.end("<html>gateway</html>");
      },
      (_req, res) => json(res, 201, { paymentUrl: created.paymentUrl }),
    ];
    for (const next of cases) {
      handler = next;
      const error = await failure(provider().createInvoice(input));
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect((error as ProviderUnavailableError).maybeSent).toBe(true);
    }
  });

  it("a timeout after the request left is unknown, never a rejection", async () => {
    handler = () => {
      // Lava received the request and never answers in time.
    };
    const started = Date.now();
    const error = await failure(
      provider({ timeoutMs: 300 }).createInvoice(input),
    );
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(error).not.toBeInstanceOf(ProviderRejectedError);
    expect((error as ProviderUnavailableError).maybeSent).toBe(true);
    expect(error.message).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(seen).toHaveLength(1);
  });

  it("a body that stalls past the timeout is unknown too", async () => {
    handler = (_req, res) => {
      res.writeHead(201, { "content-type": "application/json" });
      res.write('{"id":"7ea82675-4ded-4133-95a7-a6efbaf165cc",');
      // …and the rest never comes.
    };
    const error = await failure(
      provider({ timeoutMs: 300 }).createInvoice(input),
    );
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).maybeSent).toBe(true);
  });

  it("a connection dropped after the request arrived is unknown", async () => {
    handler = (req) => req.socket.destroy();
    const error = await failure(provider().createInvoice(input));
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).maybeSent).toBe(true);
  });

  it("a refused connection provably sent nothing", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, "127.0.0.1", resolve),
    );
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const lava = new LavaPaymentProvider({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: API_KEY,
      timeoutMs: 2_000,
      paymentUrlHosts: [],
    });
    const error = await failure(lava.createInvoice(input));
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).maybeSent).toBe(false);
  });

  it("does not follow a redirect, so the key never reaches another host", async () => {
    const other = createServer((req, res) => {
      seen.push({
        method: req.method ?? "",
        url: new URL(req.url ?? "/", "http://other"),
        headers: req.headers,
        body: "",
      });
      json(res, 201, created);
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${(other.address() as AddressInfo).port}/steal`;
    try {
      handler = (_req, res) => {
        res.writeHead(307, { location: target });
        res.end();
      };
      const error = await failure(provider().createInvoice(input));
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect(seen).toHaveLength(1);
      expect(seen.some((s) => s.url.host === "other")).toBe(false);
    } finally {
      other.close();
    }
  });

  it("refuses a payment page that is not https or not on the allowlist, keeping the invoice id", async () => {
    const cases: { url: string; hosts: string[]; ok: boolean }[] = [
      { url: "http://app.lava.top/pay/1", hosts: [], ok: false },
      { url: "javascript:alert(1)", hosts: [], ok: false },
      { url: "not a url", hosts: [], ok: false },
      { url: "https://anything.example/pay", hosts: [], ok: true },
      { url: "https://app.lava.top/pay/1", hosts: ["app.lava.top"], ok: true },
      { url: "https://evil.example/pay", hosts: ["app.lava.top"], ok: false },
      { url: "https://app.lava.top/pay/1", hosts: ["*.lava.top"], ok: true },
      { url: "https://evillava.top/pay", hosts: ["*.lava.top"], ok: false },
      {
        url: "https://app.lava.top.evil.example/pay",
        hosts: ["*.lava.top"],
        ok: false,
      },
      {
        url: "https://app.lava.top@evil.example/pay",
        hosts: ["app.lava.top"],
        ok: false,
      },
    ];
    for (const { url, hosts, ok } of cases) {
      handler = (_req, res) => json(res, 201, { ...created, paymentUrl: url });
      const call = provider({ hosts }).createInvoice(input);
      if (ok) {
        await expect(call).resolves.toMatchObject({ paymentUrl: url });
        continue;
      }
      const error = await failure(call);
      expect(error, url).toBeInstanceOf(ProviderRejectedError);
      expect((error as ProviderRejectedError).invoiceId).toBe(created.id);
    }
    handler = (_req, res) => json(res, 201, { ...created, paymentUrl: null });
    const empty = await failure(provider().createInvoice(input));
    expect(empty).toBeInstanceOf(ProviderRejectedError);
    expect((empty as ProviderRejectedError).invoiceId).toBe(created.id);
  });

  it("never puts the API key into an error", async () => {
    const errors: Error[] = [];
    handler = (_req, res) => json(res, 401, { error: `bad key ${API_KEY}` });
    errors.push(await failure(provider().createInvoice(input)));
    handler = (_req, res) => json(res, 500, { error: `bad key ${API_KEY}` });
    errors.push(await failure(provider().createInvoice(input)));
    handler = () => {};
    errors.push(
      await failure(provider({ timeoutMs: 200 }).createInvoice(input)),
    );
    for (const error of errors) {
      expect(
        JSON.stringify({ ...error, message: error.message }),
      ).not.toContain(API_KEY);
    }
  });
});

describe("reads used by reconciliation", () => {
  const invoice = {
    id: "c5a0cacc-3453-44b0-9532-aa492f1ba191",
    type: "SUBSCRIPTION_FIRST_INVOICE",
    datetime: "2026-09-29T08:44:32.42176Z",
    status: "COMPLETED",
    receipt: { amount: 50, currency: "RUB", fee: 5 },
    buyer: { email: "buyer@example.test", cardMask: "**** 1234" },
    product: { name: "Premium", offer: "Monthly" },
    parentInvoice: null,
  };

  it("getInvoice reads GET /api/v2/invoices/{id}; 404 means unknown to Lava", async () => {
    handler = (_req, res) => json(res, 200, invoice);
    await expect(provider().getInvoice(invoice.id)).resolves.toEqual({
      id: invoice.id,
      type: "SUBSCRIPTION_FIRST_INVOICE",
      status: "COMPLETED",
      datetime: invoice.datetime,
      amount: "50",
      currency: "RUB",
      buyerEmail: "buyer@example.test",
      parentInvoiceId: null,
    });
    expect(seen[0]?.url.pathname).toBe(`/api/v2/invoices/${invoice.id}`);
    expect(seen[0]?.headers["x-api-key"]).toBe(API_KEY);
    handler = (_req, res) => json(res, 404, { error: "not found" });
    await expect(provider().getInvoice(invoice.id)).resolves.toBeNull();
    handler = (_req, res) => json(res, 429, { error: "slow down" });
    await expect(provider().getInvoice(invoice.id)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    handler = (_req, res) => json(res, 200, { ...invoice, status: "PAID" });
    await expect(provider().getInvoice(invoice.id)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("findInvoices asks for every status explicitly and pages to the end", async () => {
    const all = Array.from({ length: 60 }, (_, i) => ({
      ...invoice,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    handler = (_req, res, call) => {
      const page = Number(call.url.searchParams.get("page"));
      const size = Number(call.url.searchParams.get("size"));
      json(res, 200, {
        items: all.slice((page - 1) * size, page * size),
        page,
        size,
        total: all.length,
      });
    };
    const from = new Date("2026-09-29T08:00:00.000Z");
    const to = new Date("2026-09-29T09:00:00.000Z");
    const found = await provider().findInvoices({
      buyerEmail: "buyer@example.test",
      from,
      to,
    });
    expect(found).toHaveLength(60);
    expect(seen).toHaveLength(2);
    const query = seen[0]?.url.searchParams;
    expect(seen[0]?.url.pathname).toBe("/api/v2/invoices");
    expect(query?.get("buyerEmail")).toBe("buyer@example.test");
    expect(query?.get("beginDate")).toBe(from.toISOString());
    expect(query?.get("endDate")).toBe(to.toISOString());
    // The provider default is "completed only"; the adapter never relies on it.
    expect(query?.getAll("invoiceStatuses")).toEqual([
      "NEW",
      "IN_PROGRESS",
      "COMPLETED",
      "FAILED",
    ]);
  });
});

describe("cancelSubscription (DELETE /api/v1/subscriptions)", () => {
  it("maps 204, 404, 4xx, 5xx and a timeout", async () => {
    const cancel = (timeoutMs?: number) =>
      provider(timeoutMs ? { timeoutMs } : {}).cancelSubscription({
        parentContractId: "c5a0cacc-3453-44b0-9532-aa492f1ba191",
        email: "buyer+tag@example.test",
      });
    handler = (_req, res) => {
      res.writeHead(204);
      res.end();
    };
    await expect(cancel()).resolves.toBe("cancelled");
    expect(seen[0]?.method).toBe("DELETE");
    expect(seen[0]?.url.pathname).toBe("/api/v1/subscriptions");
    expect(seen[0]?.url.searchParams.get("contractId")).toBe(
      "c5a0cacc-3453-44b0-9532-aa492f1ba191",
    );
    // "+" survives the query string (it is not turned into a space).
    expect(seen[0]?.url.searchParams.get("email")).toBe(
      "buyer+tag@example.test",
    );
    handler = (_req, res) => json(res, 404, { error: "not found" });
    await expect(cancel()).resolves.toBe("not_found");
    handler = (_req, res) => json(res, 400, { error: "cannot cancel" });
    await expect(cancel()).rejects.toBeInstanceOf(ProviderRejectedError);
    handler = (_req, res) => json(res, 502, {});
    await expect(cancel()).rejects.toBeInstanceOf(ProviderUnavailableError);
    handler = () => {};
    const lost = await failure(cancel(200));
    expect(lost).toBeInstanceOf(ProviderUnavailableError);
    expect(lost).not.toBeInstanceOf(ProviderRejectedError);
  });
});
