import { platformTables } from "@outegro/db/schema";

// Identity tables arrive with the auth feature work (users, sessions, credentials).
export const { outbox, inbox } = platformTables;
