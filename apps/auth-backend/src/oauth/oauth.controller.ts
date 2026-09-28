import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  type AuthenticatedUser,
  CurrentUser,
  Public,
} from "@outegro/nest-common";
import { z } from "zod";
import { Client, type ClientContext } from "../common/client-context.js";
import { OAuthService } from "./oauth.service.js";

const clientId = z.string().regex(/^[a-z][a-z0-9-]{2,40}$/);
const redirectUri = z.url().max(500);
// RFC 7636: S256 challenge is base64url(sha256(verifier)), 43 chars.
const challenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const authorizeSchema = z.object({
  clientId,
  redirectUri,
  codeChallenge: challenge,
  codeChallengeMethod: z.literal("S256"),
});
const tokenSchema = z.object({
  grantType: z.literal("authorization_code"),
  clientId,
  redirectUri,
  code: z.string().min(40).max(60),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});

@Controller("oauth")
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  /** id.outegro.dev checks a client and redirect before showing sign-in. */
  @Public()
  @Get("clients/:id")
  client(
    @Param("id") id: string,
    @Query({ schema: z.object({ redirectUri }) }) query: {
      redirectUri: string;
    },
  ) {
    return this.oauth.client(clientId.parse(id), query.redirectUri);
  }

  /** Called by the id.outegro.dev BFF for the signed-in user. */
  @Post("authorize")
  authorize(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: authorizeSchema }) body: z.infer<typeof authorizeSchema>,
  ) {
    return this.oauth.authorize(user.userId, body);
  }

  /** Called server-to-server by the client app's BFF on its callback. */
  @Public()
  @Post("token")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  token(
    @Body({ schema: tokenSchema }) body: z.infer<typeof tokenSchema>,
    @Client() context: ClientContext,
  ) {
    return this.oauth.exchange(body, context);
  }
}
