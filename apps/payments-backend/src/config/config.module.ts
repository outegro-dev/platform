import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  authConfig,
  checkoutConfig,
  dbConfig,
  lavaConfig,
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
      authConfig,
      checkoutConfig,
      lavaConfig,
      workersConfig,
    ]),
  ],
})
export class AppConfigModule {}
