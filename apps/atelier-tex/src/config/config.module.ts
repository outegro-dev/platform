import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import { metricsConfig, texConfig } from "./config.js";
import { env } from "./env.js";

@Module({
  imports: [createConfigModule(env, [metricsConfig, texConfig])],
})
export class AppConfigModule {}
