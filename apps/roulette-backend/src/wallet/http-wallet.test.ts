import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpWallet } from "./http-wallet.js";
import { WalletError } from "./wallet.port.js";

const TOKEN = "w".repeat(40);
type Seen = { path: string; auth: string | undefined; body: unknown };

let server: Server;
let wallet: HttpWallet;
const seen: Seen[] = [];
/** What the fake wallet answers next: status and body. */
let reply: { status: number; body: unknown; delayMs?: number } = {
  status: 200,
  body: {},
};

async function read(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw);
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    seen.push({
      path: request.url ?? "",
      auth: request.headers.authorization,
      body: await read(request),
    });
    const { status, body, delayMs } = reply;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  wallet = new HttpWallet(`http://127.0.0.1:${port}`, TOKEN, 300);
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const debit = {
  userId: "00000000-0000-4000-8000-000000000001",
  amount: 250,
  ref: "roulette:bet:b1",
  objectRef: "round:1207",
  meta: { round: 1207, color: "red" as const },
};

describe("HttpWallet", () => {
  it("debits grumbles as roulette, with the round as the object", async () => {
    reply = {
      status: 200,
      body: { ref: debit.ref, balanceAfter: "750", replayed: false },
    };
    expect(await wallet.debit(debit)).toEqual({ balance: 750 });
    expect(seen.at(-1)).toEqual({
      path: "/v1/internal/debit",
      auth: `Bearer ${TOKEN}`,
      body: {
        ref: "roulette:bet:b1",
        userId: debit.userId,
        unit: "GRM",
        amount: "250",
        source: "roulette",
        objectRef: "round:1207",
        meta: { round: 1207, color: "red" },
      },
    });
  });

  it("pays a batch with one source and reads every balance after", async () => {
    reply = {
      status: 200,
      body: {
        items: [
          { ref: "roulette:win:a", balanceAfter: "1500", replayed: false },
          { ref: "roulette:win:b", balanceAfter: "40", replayed: true },
        ],
      },
    };
    const results = await wallet.creditBatch([
      { ...debit, ref: "roulette:win:a", amount: 500 },
      { ...debit, ref: "roulette:win:b", amount: 20 },
    ]);
    expect(results).toEqual([
      { ref: "roulette:win:a", balance: 1500, replayed: false },
      { ref: "roulette:win:b", balance: 40, replayed: true },
    ]);
    expect(seen.at(-1)?.body).toMatchObject({
      unit: "GRM",
      source: "roulette",
      items: [
        { ref: "roulette:win:a", amount: "500", objectRef: "round:1207" },
        { ref: "roulette:win:b", amount: "20" },
      ],
    });
  });

  it("rolls back by ref", async () => {
    reply = {
      status: 200,
      body: { ref: debit.ref, state: "tombstoned", reversal: null },
    };
    expect(await wallet.rollback(debit.ref)).toEqual({ status: "tombstoned" });
    expect(seen.at(-1)).toMatchObject({
      path: "/v1/internal/rollback",
      body: { ref: debit.ref },
    });
  });

  it("maps refusals and silence to the port's codes", async () => {
    const codeFor = async (status: number, delayMs?: number) => {
      reply = { status, body: { error: { code: "X" } }, delayMs };
      try {
        await wallet.debit(debit);
        return "ok";
      } catch (error) {
        return error instanceof WalletError ? error.code : "other";
      }
    };
    expect(await codeFor(402)).toBe("insufficient_funds");
    expect(await codeFor(423)).toBe("restricted");
    expect(await codeFor(409)).toBe("conflict");
    expect(await codeFor(503)).toBe("unavailable");
    expect(await codeFor(200, 1000)).toBe("unavailable");
  });

  it("has no balance read for services yet", async () => {
    expect(await wallet.balance()).toBeNull();
  });
});
