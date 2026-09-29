import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import {
  AuthModule,
  ClockModule,
  createLoggerModule,
  DatabaseModule,
  HealthModule,
  MessagingModule,
  MetricsModule,
  OutboxModule,
  ValkeyModule,
  ValkeyThrottlerStorage,
} from "@outegro/nest-common";
import {
  dbConfig,
  metricsConfig,
  rabbitConfig,
  tokenConfig,
  valkeyConfig,
} from "./config/config.js";
import { AppConfigModule } from "./config/config.module.js";
import { env } from "./config/env.js";
import * as schema from "./db/schema.js";
import { IdentityModule } from "./identity.module.js";
import { KeysModule } from "./keys/keys.module.js";
import { SigningKeys } from "./keys/signing-keys.service.js";
import { RefreshStore } from "./sessions/refresh-store.js";
import { SessionStoreModule } from "./sessions/session-store.module.js";

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    createLoggerModule({
      service: "auth-backend",
      level: env().LOG_LEVEL,
      pretty: env().NODE_ENV === "development",
    }),
    HealthModule,
    MetricsModule.forRootAsync({
      inject: [metricsConfig.KEY],
      useFactory: (metrics: ConfigType<typeof metricsConfig>) => ({
        service: "auth-backend",
        port: metrics.port,
      }),
    }),
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
    // Identity verifies its own tokens locally and also requires the session
    // to be alive, so revocation takes effect immediately here.
    AuthModule.forRootAsync({
      imports: [KeysModule, SessionStoreModule],
      inject: [tokenConfig.KEY, SigningKeys, RefreshStore],
      useFactory: (
        tokens: ConfigType<typeof tokenConfig>,
        keys: SigningKeys,
        store: RefreshStore,
      ) => ({
        issuer: tokens.issuer,
        audience: tokens.audience,
        keys: keys.verificationKeys,
        isSessionActive: (user) => store.isAlive(user.sessionId),
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ValkeyThrottlerStorage],
      useFactory: (storage: ValkeyThrottlerStorage) => ({
        throttlers: [{ name: "default", ttl: 60_000, limit: 120 }],
        storage,
      }),
    }),
    IdentityModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
