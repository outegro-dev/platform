import type { DatabaseHandle } from "@outegro/nest-common";
import type * as schema from "../db/schema.js";

export type RouletteDatabase = DatabaseHandle<typeof schema>;
export type RouletteDb = RouletteDatabase["db"];
export type RouletteTx = Parameters<
  Parameters<RouletteDb["transaction"]>[0]
>[0];
/** The database or an open transaction. */
export type Executor = RouletteDb | RouletteTx;
