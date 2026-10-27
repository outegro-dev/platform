import {
  type FairInfo,
  type FairReveal,
  fairChainSchema,
  fairRevealSchema,
} from "@outegro/contracts/roulette";
import { FairRollError, type FairRollPort } from "./fair-roll.port.js";

/** The public /fair pages ask for the chain often; it changes once a round. */
const CHAIN_CACHE_MS = 5000;

/** fair-roll-backend over its internal API and the shared service token. */
export class HttpFairRoll implements FairRollPort {
  private cached: { info: Promise<FairInfo>; at: number } | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 3000,
  ) {}

  chain(): Promise<FairInfo> {
    if (this.cached && Date.now() - this.cached.at < CHAIN_CACHE_MS)
      return this.cached.info;
    const info = this.call("GET", "/v1/internal/chain").then((body) =>
      fairChainSchema.parse(body),
    );
    this.cached = { info, at: Date.now() };
    // A failure is not remembered: the next call asks again.
    info.catch(() => {
      if (this.cached?.info === info) this.cached = undefined;
    });
    return info;
  }

  async reveal(round: number): Promise<FairReveal> {
    const reveal = fairRevealSchema.parse(
      await this.call("POST", `/v1/internal/rounds/${round}/reveal`),
    );
    if (reveal.round !== round)
      throw new FairRollError(502, `asked for ${round}, got ${reveal.round}`);
    return reveal;
  }

  private async call(method: "GET" | "POST", path: string): Promise<unknown> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok)
      throw new FairRollError(
        response.status,
        `fair-roll ${method} ${path} answered ${response.status}`,
      );
    return response.json();
  }
}
