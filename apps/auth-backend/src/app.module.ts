import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import {
  createLoggerModule,
  DatabaseModule,
  HealthModule,
  MessagingModule,
  OutboxModule,
  ValkeyModule,
  ValkeyThrottlerStorage,
} from "@outegro/nest-common";
import { dbConfig, rabbitConfig, valkeyConfig } from "./config/config.js";
import { AppConfigModule } from "./config/config.module.js";
import { env } from "./config/env.js";
import * as schema from "./db/schema.js";

@Module({
  imports: [
    AppConfigModule,
    createLoggerModule({
      service: "auth-backend",
      level: env().LOG_LEVEL,
      pretty: env().NODE_ENV === "development",
    }),
    HealthModule,
    DatabaseModule.forRootAsync({
      schema,
      service: "auth-backend",
      inject: [dbConfig.KEY],
      useFactory: (db: ConfigType<typeof dbConfig>) => db,
    }),
    ValkeyModule.forRootAsync({
      inject: [valkeyConfig.KEY],
      useFactory: (valkey: ConfigType<typeof valkeyConfig>) => valkey.url,
    }),
    MessagingModule.forRootAsync({
      inject: [rabbitConfig.KEY],
      useFactory: (rabbit: ConfigType<typeof rabbitConfig>) => ({
        url: rabbit.url,
        service: "identity",
      }),
    }),
    OutboxModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ValkeyThrottlerStorage],
      useFactory: (storage: ValkeyThrottlerStorage) => ({
        throttlers: [{ name: "default", ttl: 60_000, limit: 120 }],
        storage,
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
