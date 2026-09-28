// Writes .env for every backend from its .env.example with fresh local
// secrets (ES256 key, pepper, shared service token). Local development only.
//   pnpm env:local            skip services that already have .env
//   pnpm env:local --force    regenerate all
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const force = process.argv.includes("--force");
const services = ["apps/auth-backend", "apps/notifications-backend"];
const secret = () => randomBytes(32).toString("base64url");
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const shared = {
  JWT_PRIVATE_KEY: JSON.stringify(privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
  LOGIN_CODE_PEPPER: secret(),
  INTERNAL_API_TOKEN: secret(),
};

for (const service of services) {
  const target = path.join(service, ".env");
  if (existsSync(target) && !force) {
    console.log(`skip ${target} (exists; use --force)`);
    continue;
  }
  const example = readFileSync(path.join(service, ".env.example"), "utf8");
  writeFileSync(
    target,
    example.replace(/^([A-Z_]+)=$/gm, (line, key) => (key in shared ? `${key}=${shared[key]}` : line)),
  );
  console.log(`wrote ${target}`);
}
