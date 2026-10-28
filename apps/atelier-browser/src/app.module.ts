import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  createLoggerModule,
  HealthModule,
  MetricsModule,
} from "@outegro/nest-common";
import { ApplyModule } from "./apply/apply.module.js";
import { metricsConfig } from "./config/config.js";
import { AppConfigModule } from "./config/config.module.js";
import { env } from "./config/env.js";

/** No database, queue or Valkey: a stateless browser behind a service token. */
@Module({
  imports: [
    AppConfigModule,
    createLoggerModule({
      service: "atelier-browser",
      level: env().LOG_LEVEL,
      pretty: env().NODE_ENV === "development",
    }),
    HealthModule,
    MetricsModule.forRootAsync({
      inject: [metricsConfig.KEY],
      useFactory: (metrics: ConfigType<typeof metricsConfig>) => ({
        service: "atelier-browser",
        port: metrics.port,
      }),
    }),
    ApplyModule,
  ],
})
export class AppModule {}
