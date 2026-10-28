import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  authConfig,
  dbConfig,
  hashConfig,
  identityConfig,
  metricsConfig,
  walletConfig,
} from "./config.js";
import { env } from "./env.js";

@Module({
  imports: [
    createConfigModule(env, [
      dbConfig,
      metricsConfig,
      authConfig,
      identityConfig,
      walletConfig,
      hashConfig,
    ]),
  ],
})
export class AppConfigModule {}
