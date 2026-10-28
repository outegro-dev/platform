import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import { chainConfig, dbConfig, metricsConfig } from "./config.js";
import { env } from "./env.js";

@Module({
  imports: [createConfigModule(env, [dbConfig, metricsConfig, chainConfig])],
})
export class AppConfigModule {}
