// Creates apps/auth-backend/.env for local development with a fresh ES256
// key and random secrets. Never used for production secrets.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const example = readFileSync(".env.example", "utf8");
const values = {
  JWT_PRIVATE_KEY: JSON.stringify(pem),
  LOGIN_CODE_PEPPER: randomBytes(32).toString("base64url"),
  INTERNAL_API_TOKEN:
    process.env.INTERNAL_API_TOKEN ?? randomBytes(32).toString("base64url"),
};
const env = example.replace(/^([A-Z_]+)=$/gm, (line, key) =>
  key in values ? `${key}=${values[key]}` : line,
);
if (existsSync(".env") && !process.argv.includes("--force")) {
  console.error(".env exists; pass --force to overwrite");
  process.exit(1);
}
writeFileSync(".env", env);
console.log(
  "wrote .env; INTERNAL_API_TOKEN must match notifications-backend/.env",
);
