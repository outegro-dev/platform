import type { DatabaseHandle } from "@outegro/nest-common";
import type * as schema from "../db/schema.js";

export type AtelierDatabase = DatabaseHandle<typeof schema>;
export type AtelierDb = AtelierDatabase["db"];
export type AtelierTx = Parameters<Parameters<AtelierDb["transaction"]>[0]>[0];
/** The database or an open transaction. */
export type Executor = AtelierDb | AtelierTx;
