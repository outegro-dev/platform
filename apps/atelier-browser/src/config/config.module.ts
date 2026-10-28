import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import { browserConfig, metricsConfig } from "./config.js";
import { env } from "./env.js";

@Module({
  imports: [createConfigModule(env, [metricsConfig, browserConfig])],
})
export class AppConfigModule {}
