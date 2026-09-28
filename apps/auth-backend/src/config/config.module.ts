import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  appConfig,
  dbConfig,
  internalConfig,
  loginConfig,
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
      tokenConfig,
      loginConfig,
      internalConfig,
      oauthConfig,
    ]),
  ],
})
export class AppConfigModule {}
