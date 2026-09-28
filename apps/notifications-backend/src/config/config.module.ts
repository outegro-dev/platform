import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  authConfig,
  channelsConfig,
  dbConfig,
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
      authConfig,
      channelsConfig,
    ]),
  ],
})
export class AppConfigModule {}
