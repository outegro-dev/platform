import type { DatabaseHandle } from "@outegro/nest-common";
import type * as schema from "../db/schema.js";

export type AuthDatabase = DatabaseHandle<typeof schema>;
export type AuthDb = AuthDatabase["db"];
export type AuthTx = Parameters<Parameters<AuthDb["transaction"]>[0]>[0];
