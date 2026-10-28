import { existsSync } from "node:fs";
import { z } from "zod";
import { SeedChain } from "../chain/chain.js";

// Prints the commit (seed[0]) of the chain the root in FAIR_ROLL_ROOT builds,
// without a database: the season is announced with this commit and a future
// drand round before that round's randomness becomes the public seed
// (docs/06-operations/roulette-rollout.md).
//   node dist/cli/commit.js
if (existsSync(".env")) process.loadEnvFile(".env");

const env = z
  .object({
    FAIR_ROLL_ROOT: z.string().regex(/^[0-9a-f]{64}$/),
    FAIR_ROLL_CHAIN_LENGTH: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .default(1_000_000),
  })
  .parse(process.env);

const chain = new SeedChain(
  Buffer.from(env.FAIR_ROLL_ROOT, "hex"),
  env.FAIR_ROLL_CHAIN_LENGTH,
);
console.log(
  JSON.stringify({ commit: chain.commit, chainLength: chain.length }),
);
