import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  importPKCS8,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import { tokenConfig } from "../config/config.js";

export type AccessClaims = {
  userId: string;
  sessionId: string;
  roles: string[];
  accessVersion: number;
};

/**
 * ES256 signing key for access tokens. The public half (and any retired
 * keys still in their overlap period) is published as JWKS; every service
 * verifies tokens with it, no shared secret.
 */
@Injectable()
export class SigningKeys implements OnModuleInit {
  private privateKey!: Awaited<ReturnType<typeof importPKCS8>>;
  private kid!: string;
  private published!: JWK[];
  private localKeys!: JWTVerifyGetKey;

  constructor(
    @Inject(tokenConfig.KEY)
    private readonly config: ConfigType<typeof tokenConfig>,
  ) {}

  async onModuleInit() {
    this.privateKey = await importPKCS8(this.config.privateKeyPem, "ES256", {
      extractable: true,
    });
    const current = await publicKeyOf(await exportJWK(this.privateKey));
    this.kid = current.kid;
    // Retired keys and the next one announced before it signs (rotation
    // runbook): public part only, kid = its thumbprint, each key once.
    const keys = new Map([[current.kid, current]]);
    for (const jwk of JSON.parse(this.config.previousPublicKeys) as JWK[]) {
      const key = await publicKeyOf(jwk);
      if (!keys.has(key.kid)) keys.set(key.kid, key);
    }
    this.published = [...keys.values()];
    this.localKeys = createLocalJWKSet({ keys: this.published });
  }

  jwks() {
    return { keys: this.published };
  }

  /** Key getter for verifying this service's own tokens without HTTP. */
  verificationKeys: JWTVerifyGetKey = (header, token) =>
    this.localKeys(header, token);

  async sign(claims: AccessClaims, now: Date) {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = issuedAt + this.config.accessTtlSec;
    const token = await new SignJWT({
      sid: claims.sessionId,
      roles: claims.roles,
      av: claims.accessVersion,
    })
      .setProtectedHeader({ alg: "ES256", kid: this.kid, typ: "at+jwt" })
      .setSubject(claims.userId)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.privateKey);
    return { token, expiresAt: new Date(expiresAt * 1000) };
  }
}

/** The public members of an ES256 (P-256) key, published under its RFC 7638 thumbprint. */
async function publicKeyOf(key: JWK) {
  if (key.kty !== "EC" || key.crv !== "P-256")
    throw new Error("Signing keys must be ES256 (EC P-256)");
  const jwk: JWK = { kty: key.kty, crv: key.crv, x: key.x, y: key.y };
  const kid = await calculateJwkThumbprint(jwk);
  return { ...jwk, kid, alg: "ES256", use: "sig" };
}
