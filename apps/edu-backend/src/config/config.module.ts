import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  assistConfig,
  authConfig,
  dbConfig,
  httpConfig,
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
      httpConfig,
      assistConfig,
    ]),
  ],
})
export class AppConfigModule {}
