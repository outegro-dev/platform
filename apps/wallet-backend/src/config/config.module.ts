import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  authConfig,
  dbConfig,
  httpConfig,
  metricsConfig,
  rabbitConfig,
  reconciliationConfig,
  valkeyConfig,
  walletConfig,
} from "./config.js";
import { env } from "./env.js";

/** Global, validated configuration. Inject groups with `@Inject(walletConfig.KEY)`. */
@Module({
  imports: [
    createConfigModule(env, [
      dbConfig,
      valkeyConfig,
      rabbitConfig,
      metricsConfig,
      authConfig,
      httpConfig,
      walletConfig,
      reconciliationConfig,
    ]),
  ],
})
export class AppConfigModule {}
