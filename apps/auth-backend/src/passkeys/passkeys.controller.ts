import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  AppError,
  type AuthenticatedUser,
  CurrentUser,
  Public,
} from "@outegro/nest-common";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";
import { Client, type ClientContext } from "../common/client-context.js";
import { PasskeysService } from "./passkeys.service.js";

/*
 * Wire shapes of the browser's WebAuthn responses (W3C JSON encodings, as
 * @simplewebauthn/browser sends them). Sizes follow the spec (a credential
 * id is at most 1023 bytes, a user handle 64); unknown keys are dropped.
 */
const b64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);
const credentialFields = {
  id: b64url(1400),
  rawId: b64url(1400),
  type: z.literal("public-key"),
  authenticatorAttachment: z.string().max(32).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
};
const registrationResponse = z.object({
  ...credentialFields,
  response: z.object({
    clientDataJSON: b64url(4096),
    attestationObject: b64url(32_768),
    transports: z.array(z.string().max(32)).max(10).optional(),
  }),
});
const authenticationResponse = z.object({
  ...credentialFields,
  response: z.object({
    clientDataJSON: b64url(4096),
    authenticatorData: b64url(4096),
    signature: b64url(2048),
    userHandle: b64url(128).optional(),
  }),
});

/** Shown only to the owner; one line of printable text. */
export const passkeyName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u);

const signInSchema = z.object({
  challengeId: z.uuid(),
  response: authenticationResponse,
});
const registerSchema = z.object({
  challengeId: z.uuid(),
  name: passkeyName,
  response: registrationResponse,
});
const renameSchema = z.object({ name: passkeyName }).strict();

const passkeyId = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return id;
};

@Controller()
export class PasskeysController {
  constructor(private readonly passkeys: PasskeysService) {}

  /** Called by the id.outegro.dev BFF for the sign-in page (button and autofill). */
  @Public()
  @Post("login/passkey/options")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  signInOptions(@Client() client: ClientContext) {
    return this.passkeys.authenticationOptions(client);
  }

  /** Called by the id.outegro.dev BFF; tokens go into its httpOnly cookies. */
  @Public()
  @Post("login/passkey/verify")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  signIn(
    @Body({ schema: signInSchema }) body: z.infer<typeof signInSchema>,
    @Client() client: ClientContext,
  ) {
    return this.passkeys.signIn(
      {
        challengeId: body.challengeId,
        response: body.response as AuthenticationResponseJSON,
      },
      client,
    );
  }

  @Get("me/passkeys")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.passkeys.list(user.userId);
  }

  @Post("me/passkeys/options")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  registrationOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.passkeys.registrationOptions(user);
  }

  @Post("me/passkeys")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: registerSchema }) body: z.infer<typeof registerSchema>,
    @Client() client: ClientContext,
  ) {
    return this.passkeys.register(
      user,
      {
        challengeId: body.challengeId,
        name: body.name,
        response: body.response as RegistrationResponseJSON,
      },
      client,
    );
  }

  @Patch("me/passkeys/:id")
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body({ schema: renameSchema }) body: z.infer<typeof renameSchema>,
    @Client() client: ClientContext,
  ) {
    return this.passkeys.rename(user.userId, passkeyId(id), body.name, client);
  }

  @Delete("me/passkeys/:id")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Client() client: ClientContext,
  ) {
    await this.passkeys.remove(user.userId, passkeyId(id), client);
  }
}
