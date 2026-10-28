import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import {
  authConfig,
  dbConfig,
  fairRollConfig,
  httpConfig,
  identityConfig,
  metricsConfig,
  realtimeConfig,
  servicesConfig,
  tableConfig,
  valkeyConfig,
  walletConfig,
} from "./config.js";
import { env } from "./env.js";

@Module({
  imports: [
    createConfigModule(env, [
      dbConfig,
      valkeyConfig,
      metricsConfig,
      authConfig,
      realtimeConfig,
      httpConfig,
      fairRollConfig,
      walletConfig,
      tableConfig,
      identityConfig,
      servicesConfig,
    ]),
  ],
})
export class AppConfigModule {}
