import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  ClockModule,
  createLoggerModule,
  HealthModule,
  MetricsModule,
} from "@outegro/nest-common";
import { metricsConfig } from "./config/config.js";
import { AppConfigModule } from "./config/config.module.js";
import { env } from "./config/env.js";
import { GatewayModule } from "./gateway/gateway.module.js";

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    createLoggerModule({
      service: "llm-gateway",
      level: env().LOG_LEVEL,
      pretty: env().NODE_ENV === "development",
    }),
    HealthModule,
    MetricsModule.forRootAsync({
      inject: [metricsConfig.KEY],
      useFactory: (metrics: ConfigType<typeof metricsConfig>) => ({
        service: "llm-gateway",
        port: metrics.port,
      }),
    }),
    GatewayModule,
  ],
})
export class AppModule {}
