import { Module } from "@nestjs/common";
import { JwksController } from "./jwks.controller.js";
import { SigningKeys } from "./signing-keys.service.js";

@Module({
  controllers: [JwksController],
  providers: [SigningKeys],
  exports: [SigningKeys],
})
export class KeysModule {}
