// Runs the standalone server exactly as the container will:
// copy static assets next to server.js, then start it.
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const app = process.cwd();
// Standalone output mirrors the monorepo: .next/standalone/apps/<app>/server.js
const standalone = path.join(app, ".next/standalone/apps", path.basename(app));
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build. Run `pnpm build` first.");
  process.exit(1);
}
cpSync(path.join(app, ".next/static"), path.join(standalone, ".next/static"), {
  recursive: true,
});
if (existsSync(path.join(app, "public"))) {
  cpSync(path.join(app, "public"), path.join(standalone, "public"), { recursive: true });
}
const port = process.argv[2] ?? process.env.PORT ?? "3000";
spawn(process.execPath, [path.join(standalone, "server.js")], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    HOSTNAME: process.env.HOSTNAME ?? "0.0.0.0",
  },
}).on("exit", (code) => process.exit(code ?? 0));
