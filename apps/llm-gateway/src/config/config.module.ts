import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import { gatewayConfig, metricsConfig, providersConfig } from "./config.js";
import { env } from "./env.js";

@Module({
  imports: [
    createConfigModule(env, [metricsConfig, gatewayConfig, providersConfig]),
  ],
})
export class AppConfigModule {}
