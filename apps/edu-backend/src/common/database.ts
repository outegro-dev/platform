import type { DatabaseHandle } from "@outegro/nest-common";
import type * as schema from "../db/schema.js";

export type EduDatabase = DatabaseHandle<typeof schema>;
export type EduDb = EduDatabase["db"];
export type EduTx = Parameters<Parameters<EduDb["transaction"]>[0]>[0];
/** The database or an open transaction. */
export type Executor = EduDb | EduTx;
