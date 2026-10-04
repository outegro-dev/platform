// Writes local env files from each app's .env.example with fresh local
// secrets (ES256 key, pepper, shared service token, Lava webhook secret).
// Local development only.
//   pnpm env:local            create missing files; add variables that appeared
//                             in .env.example to existing ones, keeping secrets
//   pnpm env:local --force    regenerate everything
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const force = process.argv.includes("--force");
const apps = [
  { dir: "apps/pay-web", file: ".env.local" },
  { dir: "apps/auth-backend", file: ".env" },
  { dir: "apps/notifications-backend", file: ".env" },
  { dir: "apps/payments-backend", file: ".env" },
  { dir: "apps/battleship-backend", file: ".env" },
  { dir: "apps/edu-backend", file: ".env" },
  { dir: "apps/id-web", file: ".env.local" },
  { dir: "apps/battleship-web", file: ".env.local" },
  { dir: "apps/edu-web", file: ".env.local" },
  { dir: "apps/admin-web", file: ".env.local" },
];
const secret = () => randomBytes(32).toString("base64url");
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const shared = {
  JWT_PRIVATE_KEY: JSON.stringify(privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
  LOGIN_CODE_PEPPER: secret(),
  INTERNAL_API_TOKEN: secret(),
  // What a local Lava webhook sender puts in X-Api-Key; never the API key itself.
  LAVA_WEBHOOK_SECRET: secret(),
};

const variable = /^([A-Z][A-Z0-9_]*)=/;
const keyOf = (line) => line.match(variable)?.[1];
const valuesOf = (text) =>
  Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const key = keyOf(line);
      return key ? [[key, line.slice(key.length + 1)]] : [];
    }),
  );
const fill = (text) =>
  text.replace(/^([A-Z][A-Z0-9_]*)=$/gm, (line, key) => (key in shared ? `${key}=${shared[key]}` : line));

// Existing secrets win, so services keep sharing one token and one signing key.
if (!force) {
  for (const app of apps) {
    const target = path.join(app.dir, app.file);
    if (!existsSync(target)) continue;
    const current = valuesOf(readFileSync(target, "utf8"));
    for (const key of Object.keys(shared)) if (current[key]) shared[key] = current[key];
  }
}

for (const app of apps) {
  const target = path.join(app.dir, app.file);
  const example = readFileSync(path.join(app.dir, ".env.example"), "utf8");
  if (force || !existsSync(target)) {
    writeFileSync(target, fill(example));
    console.log(`wrote ${target}`);
    continue;
  }
  const current = readFileSync(target, "utf8");
  const present = valuesOf(current);
  const missing = example.split(/\r?\n/).filter((line) => {
    const key = keyOf(line);
    return key && !(key in present);
  });
  if (missing.length === 0) {
    console.log(`ok ${target}`);
    continue;
  }
  writeFileSync(target, `${current.trimEnd()}\n${fill(missing.join("\n"))}\n`);
  console.log(`added to ${target}: ${missing.map(keyOf).join(", ")}`);
}
