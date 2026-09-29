import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  authConfig,
  checkoutConfig,
  dbConfig,
  lavaConfig,
  metricsConfig,
  payWebConfig,
  rabbitConfig,
  valkeyConfig,
  workersConfig,
} from "./config.js";
import { env } from "./env.js";

/** Global, validated configuration. Inject groups with `@Inject(lavaConfig.KEY)`. */
@Module({
  imports: [
    createConfigModule(env, [
      dbConfig,
      valkeyConfig,
      rabbitConfig,
      metricsConfig,
      authConfig,
      checkoutConfig,
      payWebConfig,
      lavaConfig,
      workersConfig,
    ]),
  ],
})
export class AppConfigModule {}
