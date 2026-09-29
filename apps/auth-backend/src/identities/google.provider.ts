import type { ConfigType } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { googleConfig } from "../config/config.js";

export type GoogleProfile = {
  /** Stable Google account id (`sub`). */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

export type GoogleCode = { code: string; codeVerifier: string; nonce: string };

/** Google answered, and the answer is "no": a bad, reused or foreign code. */
export class GoogleRejected extends Error {}
/** Google could not be reached; the user may retry. */
export class GoogleUnavailable extends Error {}

/** Authorization code (PKCE) in, verified ID token claims out. */
export interface GoogleProvider {
  readonly enabled: boolean;
  readonly clientId: string | null;
  readonly redirectUri: string | null;
  verify(input: GoogleCode): Promise<GoogleProfile>;
}
export const GOOGLE_PROVIDER = Symbol("GOOGLE_PROVIDER");

const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().max(254).optional(),
  // Older tokens carried the flag as a string.
  email_verified: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
  name: z.string().max(200).optional(),
  nonce: z.string().optional(),
});

/** Google OpenID Connect: token endpoint, then ID token checks per Google docs. */
export class GoogleOidcProvider implements GoogleProvider {
  readonly enabled = true;
  private readonly keys = createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
  );

  constructor(
    readonly clientId: string,
    private readonly clientSecret: string,
    readonly redirectUri: string,
  ) {}

  async verify({ code, codeVerifier, nonce }: GoogleCode) {
    let response: Response;
    try {
      response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw new GoogleUnavailable((error as Error).message);
    }
    if (response.status >= 500)
      throw new GoogleUnavailable(`google ${response.status}`);
    const body = (await response.json().catch(() => ({}))) as {
      id_token?: string;
      error?: string;
    };
    if (!response.ok || !body.id_token)
      throw new GoogleRejected(body.error ?? `google ${response.status}`);

    let claims: z.infer<typeof claimsSchema>;
    try {
      const { payload } = await jwtVerify(body.id_token, this.keys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: this.clientId,
        algorithms: ["RS256"],
      });
      claims = claimsSchema.parse(payload);
    } catch {
      throw new GoogleRejected("invalid id token");
    }
    if (claims.nonce !== nonce) throw new GoogleRejected("nonce mismatch");
    return {
      subject: claims.sub,
      email: claims.email?.toLowerCase() ?? null,
      emailVerified:
        claims.email_verified === true || claims.email_verified === "true",
      name: claims.name ?? null,
    };
  }
}

export class DisabledGoogleProvider implements GoogleProvider {
  readonly enabled = false;
  readonly clientId = null;
  readonly redirectUri = null;
  async verify(): Promise<GoogleProfile> {
    throw new GoogleRejected("google sign-in is not configured");
  }
}

export const googleProvider = {
  provide: GOOGLE_PROVIDER,
  inject: [googleConfig.KEY],
  useFactory: (config: ConfigType<typeof googleConfig>): GoogleProvider =>
    config.clientId && config.clientSecret && config.redirectUri
      ? new GoogleOidcProvider(
          config.clientId,
          config.clientSecret,
          config.redirectUri,
        )
      : new DisabledGoogleProvider(),
};
