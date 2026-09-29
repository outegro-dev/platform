import { Body, Controller, Delete, Get, HttpCode, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { localeSchema } from "@outegro/contracts";
import {
  type AuthenticatedUser,
  CurrentUser,
  Public,
} from "@outegro/nest-common";
import { z } from "zod";
import { Client, type ClientContext } from "../common/client-context.js";
import { IdentitiesService } from "./identities.service.js";

/** What id-web sends after Google redirected back to its callback. */
const googleCode = z.object({
  code: z.string().min(10).max(2048),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  nonce: z.string().min(16).max(128),
});
const signInSchema = googleCode.extend({ locale: localeSchema.default("en") });

@Controller()
export class IdentitiesController {
  constructor(private readonly identities: IdentitiesService) {}

  @Public()
  @Get("login/google/config")
  config() {
    return this.identities.config();
  }

  /** Called by the id.outegro.dev BFF; tokens go into its httpOnly cookies. */
  @Public()
  @Post("login/google")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  signIn(
    @Body({ schema: signInSchema }) body: z.infer<typeof signInSchema>,
    @Client() client: ClientContext,
  ) {
    return this.identities.signIn(body, client);
  }

  @Get("me/identities")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.identities.list(user.userId);
  }

  @Post("me/identities/google")
  @HttpCode(200)
  link(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: googleCode }) body: z.infer<typeof googleCode>,
  ) {
    return this.identities.link(user.userId, body);
  }

  @Delete("me/identities/google")
  @HttpCode(204)
  async unlink(@CurrentUser() user: AuthenticatedUser) {
    await this.identities.unlink(user.userId);
  }
}
