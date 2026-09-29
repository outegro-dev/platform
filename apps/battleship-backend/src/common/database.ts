import type { DatabaseHandle } from "@outegro/nest-common";
import type * as schema from "../db/schema.js";

export type BattleshipDatabase = DatabaseHandle<typeof schema>;
export type BattleshipDb = BattleshipDatabase["db"];
export type BattleshipTx = Parameters<
  Parameters<BattleshipDb["transaction"]>[0]
>[0];
/** The database or an open transaction. */
export type Executor = BattleshipDb | BattleshipTx;
