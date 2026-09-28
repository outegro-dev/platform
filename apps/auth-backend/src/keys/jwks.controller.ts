import { Controller, Get, Header } from "@nestjs/common";
import { Public } from "@outegro/nest-common";
import { SigningKeys } from "./signing-keys.service.js";

@Public()
@Controller(".well-known")
export class JwksController {
  constructor(private readonly keys: SigningKeys) {}

  /** Public keys for verifying access tokens; cached by every service. */
  @Get("jwks.json")
  @Header("cache-control", "public, max-age=300")
  jwks() {
    return this.keys.jwks();
  }
}
