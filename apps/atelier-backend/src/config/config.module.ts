import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  authConfig,
  cvLinksConfig,
  dbConfig,
  httpConfig,
  metricsConfig,
  pipelineConfig,
  rabbitConfig,
  servicesConfig,
  storageConfig,
  valkeyConfig,
  workerConfig,
} from "./config.js";
import { env } from "./env.js";

@Module({
  imports: [
    createConfigModule(env, [
      dbConfig,
      valkeyConfig,
      rabbitConfig,
      metricsConfig,
      authConfig,
      httpConfig,
      pipelineConfig,
      cvLinksConfig,
      storageConfig,
      servicesConfig,
      workerConfig,
    ]),
  ],
})
export class AppConfigModule {}
