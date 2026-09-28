import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@outegro/db";
import { env } from "../config/env.js";

if (existsSync(".env")) process.loadEnvFile(".env");

// Run as a Kubernetes Job (Argo CD PreSync) before the new version starts.
const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
await runMigrations(env().DATABASE_URL, folder);
console.log(
  JSON.stringify({ level: "info", message: "migrations applied", folder }),
);
