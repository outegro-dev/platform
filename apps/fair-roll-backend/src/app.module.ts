import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  ClockModule,
  createLoggerModule,
  DatabaseModule,
  HealthModule,
  MetricsModule,
} from "@outegro/nest-common";
import { InternalController } from "./chain/internal.controller.js";
import { RevealService } from "./chain/reveal.service.js";
import { FairRollMetrics } from "./common/metrics.js";
import { dbConfig, metricsConfig } from "./config/config.js";
import { AppConfigModule } from "./config/config.module.js";
import { env } from "./config/env.js";
import * as schema from "./db/schema.js";

/**
 * fair-roll (ADR-012): holds the secret root of the seed chain and reveals
 * rounds strictly in order. No user API, no broker, no Valkey.
 */
@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    createLoggerModule({
      service: "fair-roll-backend",
      level: env().LOG_LEVEL,
      pretty: env().NODE_ENV === "development",
    }),
    HealthModule,
    MetricsModule.forRootAsync({
      inject: [metricsConfig.KEY],
      useFactory: (metrics: ConfigType<typeof metricsConfig>) => ({
        service: "fair-roll-backend",
        port: metrics.port,
      }),
    }),
    DatabaseModule.forRootAsync({
      schema,
      service: "fair-roll-backend",
      inject: [dbConfig.KEY],
      useFactory: (db: ConfigType<typeof dbConfig>) => db,
    }),
  ],
  controllers: [InternalController],
  providers: [FairRollMetrics, RevealService],
})
export class AppModule {}
