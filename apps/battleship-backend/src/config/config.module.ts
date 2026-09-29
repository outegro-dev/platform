import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  authConfig,
  dbConfig,
  httpConfig,
  rabbitConfig,
  realtimeConfig,
  valkeyConfig,
} from "./config.js";
import { env } from "./env.js";

@Module({
  imports: [
    createConfigModule(env, [
      dbConfig,
      valkeyConfig,
      rabbitConfig,
      authConfig,
      realtimeConfig,
      httpConfig,
    ]),
  ],
})
export class AppConfigModule {}
