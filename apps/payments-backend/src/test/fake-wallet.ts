import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

type Ref = {
  userId: string;
  amount: bigint;
  state: "debited" | "reversed" | "tombstone";
};

/**
 * The wallet's internal API as payments uses it (docs/02-contracts/wallet.md):
 * debits by ref, rollbacks with tombstones, balances. `mode` breaks it the
 * ways a network does.
 */
export class FakeWallet {
  readonly balances = new Map<string, bigint>();
  readonly refs = new Map<string, Ref>();
  readonly calls: { path: string; body: Record<string, unknown> }[] = [];
  /** `lose-answer`: the next debit goes through, its answer never comes. */
  mode: "ok" | "down" | "lose-answer" = "ok";
  private server: Server | null = null;
  url = "";

  async start() {
    this.server = createServer((req, res) => {
      void this.handle(req).then(
        (answer) => {
          if (answer === "drop") {
            req.socket.destroy();
            return;
          }
          res.statusCode = answer.status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(answer.body));
        },
        () => {
          res.statusCode = 500;
          res.end();
        },
      );
    });
    await new Promise<void>((resolve) =>
      this.server?.listen(0, "127.0.0.1", resolve),
    );
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    this.server?.close();
  }

  debits(ref: string) {
    return this.calls.filter(
      (call) => call.path.endsWith("/debit") && call.body.ref === ref,
    );
  }

  private async handle(
    req: IncomingMessage,
  ): Promise<{ status: number; body: unknown } | "drop"> {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text || "{}") as Record<string, unknown>;
    const path = req.url ?? "";
    this.calls.push({ path, body });
    if (
      req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_TOKEN}`
    )
      return { status: 401, body: { error: { code: "UNAUTHENTICATED" } } };
    if (this.mode === "down")
      return {
        status: 503,
        body: { error: { code: "DEPENDENCY_UNAVAILABLE" } },
      };

    if (path === "/v1/internal/balances") {
      const ids = body.userIds as string[];
      return {
        status: 200,
        body: {
          items: ids.map((userId) => ({
            userId,
            unit: "GRM",
            balance: (this.balances.get(userId) ?? 0n).toString(),
            state: "active",
            exists: this.balances.has(userId),
          })),
        },
      };
    }
    if (path === "/v1/internal/debit") {
      const ref = String(body.ref);
      const userId = String(body.userId);
      const amount = BigInt(String(body.amount));
      const held = this.refs.get(ref);
      if (held && held.state !== "debited") return conflict("rolled_back");
      const balance = this.balances.get(userId) ?? 0n;
      if (!held) {
        if (balance < amount)
          return {
            status: 402,
            body: { error: { code: "INSUFFICIENT_FUNDS" } },
          };
        this.balances.set(userId, balance - amount);
        this.refs.set(ref, { userId, amount, state: "debited" });
      }
      if (this.mode === "lose-answer") {
        this.mode = "ok";
        return "drop";
      }
      return {
        status: 200,
        body: {
          ref,
          userId,
          kind: "debit",
          amount: `-${amount}`,
          balanceAfter: (this.balances.get(userId) ?? 0n).toString(),
          replayed: Boolean(held),
        },
      };
    }
    if (path === "/v1/internal/rollback") {
      const ref = String(body.ref);
      const held = this.refs.get(ref);
      if (!held) {
        this.refs.set(ref, { userId: "", amount: 0n, state: "tombstone" });
        return {
          status: 200,
          body: { ref, state: "tombstoned", replayed: false },
        };
      }
      if (held.state === "debited") {
        held.state = "reversed";
        this.balances.set(
          held.userId,
          (this.balances.get(held.userId) ?? 0n) + held.amount,
        );
      }
      return {
        status: 200,
        body: {
          ref,
          state: held.state === "tombstone" ? "tombstoned" : "reversed",
        },
      };
    }
    return { status: 404, body: { error: { code: "NOT_FOUND" } } };
  }
}

const conflict = (why: string) => ({
  status: 409,
  body: {
    error: { code: "IDEMPOTENCY_CONFLICT", fieldErrors: { ref: [why] } },
  },
});
