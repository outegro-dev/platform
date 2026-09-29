import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  appConfig,
  dbConfig,
  googleConfig,
  internalConfig,
  loginConfig,
  metricsConfig,
  oauthConfig,
  rabbitConfig,
  tokenConfig,
  valkeyConfig,
} from "./config.js";
import { env } from "./env.js";

/** Global, validated configuration. Inject groups with `@Inject(tokenConfig.KEY)`. */
@Module({
  imports: [
    createConfigModule(env, [
      appConfig,
      dbConfig,
      valkeyConfig,
      rabbitConfig,
      metricsConfig,
      tokenConfig,
      loginConfig,
      internalConfig,
      oauthConfig,
      googleConfig,
    ]),
  ],
})
export class AppConfigModule {}
