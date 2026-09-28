import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { localeSchema } from "@outegro/contracts";
import { Public } from "@outegro/nest-common";
import { z } from "zod";
import { Client, type ClientContext } from "../common/client-context.js";
import { LoginService } from "./login.service.js";

const challengeSchema = z.object({
  email: z.email().max(254),
  locale: localeSchema.default("en"),
});

const verifySchema = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});

/** Called by the id.outegro.dev BFF; tokens go into its httpOnly cookies. */
@Public()
@Controller("login/challenges")
export class LoginController {
  constructor(private readonly login: LoginService) {}

  @Post()
  request(
    @Body({ schema: challengeSchema }) body: z.infer<typeof challengeSchema>,
    @Client() client: ClientContext,
  ) {
    return this.login.requestChallenge(body.email, body.locale, client);
  }

  @Post("verify")
  @HttpCode(200)
  verify(
    @Body({ schema: verifySchema }) body: z.infer<typeof verifySchema>,
    @Client() client: ClientContext,
  ) {
    return this.login.verify(body.challengeId, body.code, client);
  }
}
