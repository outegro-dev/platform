#!/usr/bin/env node
/**
 * Local development only: an ES256 key pair, its public JWKS for the api
 * (DEV_AUTH_JWKS_FILE, honoured only with NODE_ENV=development) and an
 * access token with the owner role, valid for 12 hours.
 *
 *   node dist/tools/dev-token.js --user <uuid> [--dir <dir>] [--roles owner]
 *     → prints the token; writes <dir>/jwks.json (public) and <dir>/key.json,
 *       by default in ~/.atelier-dev-auth (outside the repository)
 *
 * The issuer and audience are AUTH_ISSUER and AUTH_AUDIENCE of the
 * environment (.env), so the api accepts the token.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fail, parseArgs, userKey } from "./cli.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const args = parseArgs(process.argv.slice(2));
const user = userKey(args.get("user"));
if (!user) fail("usage: dev-token --user <uuid> [--dir <dir>] [--roles owner]");
const dir = resolve(args.get("dir") ?? join(homedir(), ".atelier-dev-auth"));
const issuer = process.env.AUTH_ISSUER ?? "http://localhost:4001";
const audience = process.env.AUTH_AUDIENCE ?? "outegro";
const roles = (args.get("roles") ?? "owner").split(",").filter(Boolean);

const { exportJWK, generateKeyPair, importJWK, SignJWT } = await import("jose");
mkdirSync(dir, { recursive: true });
const keyFile = join(dir, "key.json");
let privateJwk: Record<string, unknown>;
if (existsSync(keyFile)) privateJwk = JSON.parse(readFileSync(keyFile, "utf8"));
else {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  privateJwk = { ...(await exportJWK(privateKey)), kid: "dev", alg: "ES256" };
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid: "dev",
    alg: "ES256",
    use: "sig",
  };
  writeFileSync(keyFile, JSON.stringify(privateJwk));
  writeFileSync(join(dir, "jwks.json"), JSON.stringify({ keys: [publicJwk] }));
}
const key = await importJWK(privateJwk, "ES256");
const token = await new SignJWT({ sid: randomUUID(), roles, av: 0 })
  .setProtectedHeader({ alg: "ES256", kid: "dev", typ: "at+jwt" })
  .setSubject(user)
  .setIssuer(issuer)
  .setAudience(audience)
  .setIssuedAt()
  .setExpirationTime("12h")
  .sign(key);
console.error(`DEV_AUTH_JWKS_FILE=${join(dir, "jwks.json")}`);
console.log(token);
