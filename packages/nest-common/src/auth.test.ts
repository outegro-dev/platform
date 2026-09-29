import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  Controller,
  Get,
  HttpCode,
  Module,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTHeaderParameters,
  SignJWT,
} from "jose";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  AccessTokenVerifier,
  type AuthenticatedUser,
  AuthModule,
  CurrentUser,
  Public,
} from "./auth.js";
import { configureApp } from "./bootstrap.js";
import { createServiceTokenGuard } from "./internal.js";
import { createLoggerModule } from "./logging.js";

const ISSUER = "https://id.outegro.dev";
const AUDIENCE = "outegro";
const SERVICE_TOKEN = randomBytes(32).toString("hex");

type TestKey = { kid: string; privateKey: CryptoKey; jwk: JWK };

async function newKey(kid: string): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid,
    alg: "ES256",
    use: "sig",
  };
  return { kid, privateKey, jwk };
}

type Bend = {
  header?: Partial<JWTHeaderParameters>;
  claims?: Record<string, unknown>;
  subject?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
};

/** An access token as Identity signs it, optionally bent in one way. */
function sign(key: TestKey, bend: Bend = {}) {
  return new SignJWT({ sid: randomUUID(), roles: [], av: 0, ...bend.claims })
    .setProtectedHeader({
      alg: "ES256",
      kid: key.kid,
      typ: "at+jwt",
      ...bend.header,
    })
    .setSubject(bend.subject ?? randomUUID())
    .setIssuer(bend.issuer ?? ISSUER)
    .setAudience(bend.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(bend.expiresIn ?? "5m")
    .sign(key.privateKey);
}

const segment = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** `alg: none`: an owner token with no signature at all. */
function unsigned(key: TestKey) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: randomUUID(),
    sid: randomUUID(),
    roles: ["owner"],
    av: 0,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + 300,
  };
  return `${segment({ alg: "none", kid: key.kid, typ: "at+jwt" })}.${segment(claims)}.`;
}

/** HS256 keyed with the published public key, the classic algorithm confusion. */
function hmacWithPublicKey(key: TestKey) {
  return new SignJWT({ sid: randomUUID(), roles: ["owner"], av: 0 })
    .setProtectedHeader({ alg: "HS256", kid: key.kid, typ: "at+jwt" })
    .setSubject(randomUUID())
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JSON.stringify(key.jwk)));
}

// Identity's JWKS as another service sees it: the set can change between
// requests and every fetch is counted.
let published: JWK[] = [];
let fetches = 0;
const jwksServer = createServer((_req, res) => {
  fetches += 1;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ keys: published }));
});
let jwksUrl: URL;

const remoteVerifier = () =>
  new AccessTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys: jwksUrl,
  });

const ServiceToken = createServiceTokenGuard(() => SERVICE_TOKEN);

@Controller("things")
class ThingsController {
  @Get("mine")
  mine(@CurrentUser() user: AuthenticatedUser) {
    return { userId: user.userId };
  }
}

@Public()
@UseGuards(ServiceToken)
@Controller("internal/things")
class InternalThingsController {
  @Post("lookup")
  @HttpCode(200)
  lookup() {
    return { ok: true };
  }
}

let app: NestExpressApplication;

beforeAll(async () => {
  await new Promise<void>((resolve) =>
    jwksServer.listen(0, "127.0.0.1", resolve),
  );
  const { port } = jwksServer.address() as AddressInfo;
  jwksUrl = new URL(`http://127.0.0.1:${port}/.well-known/jwks.json`);

  @Module({
    imports: [
      createLoggerModule({ service: "test", level: "silent" }),
      AuthModule.forRootAsync({
        useFactory: () => ({
          issuer: ISSUER,
          audience: AUDIENCE,
          keys: jwksUrl,
        }),
      }),
    ],
    controllers: [ThingsController, InternalThingsController],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestModule],
  }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
});
afterAll(async () => {
  await app?.close();
  jwksServer.close();
});
afterEach(() => vi.useRealTimers());

describe("TC-ID-10-01: key rotation seen from another service", () => {
  it("picks up a new key on its first unknown kid and drops the retired one with the JWKS", async () => {
    const [current, next] = await Promise.all([
      newKey("key-1"),
      newKey("key-2"),
    ]);
    const start = Date.now();
    vi.setSystemTime(start);
    published = [current.jwk];
    const verifier = remoteVerifier();
    const base = fetches;
    await expect(verifier.verify(await sign(current))).resolves.toBeTruthy();
    expect(fetches - base).toBe(1);

    // Identity rotates: the next key signs, the retired one stays published.
    published = [next.jwk, current.jwk];
    vi.setSystemTime(start + 31_000);
    await expect(verifier.verify(await sign(next))).resolves.toBeTruthy();
    await expect(verifier.verify(await sign(current))).resolves.toBeTruthy();
    expect(fetches - base).toBe(2);

    // The overlap is over: once the cached set ages out (10 min), the
    // retired key is refused even for a token that has not expired.
    published = [next.jwk];
    vi.setSystemTime(start + 31_000 + 600_000);
    await expect(verifier.verify(await sign(current))).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(verifier.verify(await sign(next))).resolves.toBeTruthy();
    expect(fetches - base).toBe(3);
  });

  it("refetches at most once per cooldown however many unknown kids arrive", async () => {
    const [current, stranger] = await Promise.all([
      newKey("key-1"),
      newKey("unpublished"),
    ]);
    const start = Date.now();
    vi.setSystemTime(start);
    published = [current.jwk];
    const verifier = remoteVerifier();
    await verifier.verify(await sign(current));
    const base = fetches;

    vi.setSystemTime(start + 31_000);
    const forged = await Promise.all(
      Array.from({ length: 20 }, () =>
        sign(stranger, { header: { kid: randomUUID() } }),
      ),
    );
    const burst = await Promise.allSettled(
      forged.map((token) => verifier.verify(token)),
    );
    expect(burst.every((result) => result.status === "rejected")).toBe(true);
    for (const token of forged) {
      await expect(verifier.verify(token)).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    }
    expect(fetches - base).toBe(1);

    // After the cooldown the next unknown kid costs one more fetch, no more.
    vi.setSystemTime(start + 62_000);
    await expect(verifier.verify(forged[0] ?? "")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(fetches - base).toBe(2);
    // Genuine tokens were served from the cache the whole time.
    await expect(verifier.verify(await sign(current))).resolves.toBeTruthy();
    expect(fetches - base).toBe(2);
  });

  it("verifies an announced key at once; an unannounced one waits out the cooldown", async () => {
    const [current, next] = await Promise.all([
      newKey("key-1"),
      newKey("key-2"),
    ]);
    const start = Date.now();
    vi.setSystemTime(start);
    // Runbook phase 1: the next key is published before it signs anything.
    published = [current.jwk, next.jwk];
    const announced = remoteVerifier();
    await announced.verify(await sign(current));
    // A service that fetched the set before the announcement.
    published = [current.jwk];
    const unannounced = remoteVerifier();
    await unannounced.verify(await sign(current));
    const base = fetches;

    // Phase 2 a few seconds later: the next key signs.
    published = [next.jwk, current.jwk];
    vi.setSystemTime(start + 5_000);
    const token = await sign(next);
    await expect(announced.verify(token)).resolves.toBeTruthy();
    await expect(unannounced.verify(token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(fetches - base).toBe(0);
    vi.setSystemTime(start + 30_000);
    await expect(unannounced.verify(token)).resolves.toBeTruthy();
    expect(fetches - base).toBe(1);
  });
});

describe("TC-ID-10-03: token confusion", () => {
  it("refuses other issuers, audiences, token types and algorithms without fetching keys", async () => {
    // The stranger reuses the published kid with a key of its own.
    const [current, stranger] = await Promise.all([
      newKey("key-1"),
      newKey("key-1"),
    ]);
    published = [current.jwk];
    const verifier = remoteVerifier();
    await expect(verifier.verify(await sign(current))).resolves.toBeTruthy();
    const base = fetches;

    const forgeries: Record<string, string> = {
      "another issuer": await sign(current, { issuer: "https://id.evil.test" }),
      "another audience": await sign(current, {
        audience: "payments-internal",
      }),
      "a plain JWT type": await sign(current, { header: { typ: "JWT" } }),
      "an ID token type": await sign(current, { header: { typ: "id+jwt" } }),
      "no token type": await sign(current, { header: { typ: undefined } }),
      "a machine token": await sign(current, {
        subject: "payments-backend",
        claims: { sid: undefined, roles: undefined, scope: "users.lookup" },
      }),
      "an expired token": await sign(current, { expiresIn: "-1m" }),
      "alg none": unsigned(current),
      "HS256 keyed with the public key": await hmacWithPublicKey(current),
      "another key under the same kid": await sign(stranger),
    };
    for (const [name, token] of Object.entries(forgeries)) {
      await expect(verifier.verify(token), name).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    }
    expect(fetches).toBe(base);
  });

  it("a service token opens no user route and a user token no internal one", async () => {
    const current = await newKey("key-1");
    published = [current.jwk];
    const userToken = await sign(current, { claims: { roles: ["owner"] } });
    const http = () => request(app.getHttpServer());

    await http()
      .get("/v1/things/mine")
      .set("authorization", `Bearer ${SERVICE_TOKEN}`)
      .expect(401);
    await http()
      .post("/v1/internal/things/lookup")
      .set("authorization", `Bearer ${userToken}`)
      .expect(401);
    // The same credentials where they belong.
    await http()
      .get("/v1/things/mine")
      .set("authorization", `Bearer ${userToken}`)
      .expect(200);
    await http()
      .post("/v1/internal/things/lookup")
      .set("authorization", `Bearer ${SERVICE_TOKEN}`)
      .expect(200, { ok: true });
  });
});
