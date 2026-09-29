import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  authConfig,
  channelsConfig,
  dbConfig,
  metricsConfig,
  rabbitConfig,
  valkeyConfig,
} from "./config.js";
import { env } from "./env.js";

@Module({
  imports: [
    createConfigModule(env, [
      dbConfig,
      valkeyConfig,
      rabbitConfig,
      metricsConfig,
      authConfig,
      channelsConfig,
    ]),
  ],
})
export class AppConfigModule {}
