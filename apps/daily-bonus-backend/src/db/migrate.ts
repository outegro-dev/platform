import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@outegro/db";
import { databaseEnvSchema, defineEnv } from "@outegro/nest-common";

if (existsSync(".env")) process.loadEnvFile(".env");

// Runs as a Kubernetes Job (Argo CD PreSync) before the new version starts.
// It needs only the database URL, never the application secrets.
const env = defineEnv(databaseEnvSchema);
const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
await runMigrations(env().DATABASE_URL, folder);
console.log(
  JSON.stringify({ level: "info", message: "migrations applied", folder }),
);
