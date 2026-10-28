import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { createLoggerModule, MetricsModule } from "@outegro/nest-common";
import { metricsConfig } from "./config/config.js";
import { AppConfigModule } from "./config/config.module.js";
import { env } from "./config/env.js";
import { RenderModule } from "./render/render.module.js";

/** No database, queue or user auth: one internal endpoint behind a service token. */
@Module({
  imports: [
    AppConfigModule,
    createLoggerModule({
      service: "atelier-tex",
      level: env().LOG_LEVEL,
      pretty: env().NODE_ENV === "development",
    }),
    MetricsModule.forRootAsync({
      inject: [metricsConfig.KEY],
      useFactory: (metrics: ConfigType<typeof metricsConfig>) => ({
        service: "atelier-tex",
        port: metrics.port,
      }),
    }),
    RenderModule,
  ],
})
export class AppModule {}
