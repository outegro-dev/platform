import { readFileSync } from "node:fs";
import { type DynamicModule, Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import {
  AuthModule,
  ClockModule,
  createLoggerModule,
  DatabaseModule,
  HealthModule,
  MetricsModule,
  ValkeyModule,
  ValkeyThrottlerStorage,
} from "@outegro/nest-common";
import {
  authConfig,
  dbConfig,
  httpConfig,
  metricsConfig,
  valkeyConfig,
} from "./config/config.js";
import { AppConfigModule } from "./config/config.module.js";
import { env, type Role } from "./config/env.js";
import * as schema from "./db/schema.js";
import { ApiModule, InfraModule, OrchestratorModule } from "./modules.js";
import { WorkerModule } from "./worker/worker.module.js";

/**
 * Access tokens: Identity's JWKS, or locally (NODE_ENV=development only) the
 * keys of DEV_AUTH_JWKS_FILE written by `node dist/tools/dev-token.js`.
 */
async function authKeys(auth: ConfigType<typeof authConfig>) {
  if (auth.devJwksFile) {
    // jose is a dev dependency here: loaded only on this development path.
    const { createLocalJWKSet } = await import("jose");
    return createLocalJWKSet(
      JSON.parse(readFileSync(auth.devJwksFile, "utf8")),
    );
  }
  return new URL(auth.jwksUrl ?? "");
}

/**
 * One image, two roles (ROLE, a comma list): `api` serves the HTTP API and
 * the CV links and runs the orchestrator, its outbox relay and timers;
 * `worker` consumes the task queues. Production runs `api,worker` in one
 * process.
 */
@Module({})
export class AppModule {
  static forRoles(roles: readonly Role[]): DynamicModule {
    const api = roles.includes("api");
    const worker = roles.includes("worker");
    const auth = api ? [AuthModuleFactory()] : [];
    return {
      module: AppModule,
      imports: [
        AppConfigModule,
        ClockModule,
        createLoggerModule({
          service: "atelier-backend",
          level: env().LOG_LEVEL,
          pretty: env().NODE_ENV === "development",
        }),
        HealthModule,
        MetricsModule.forRootAsync({
          inject: [metricsConfig.KEY],
          useFactory: (metrics: ConfigType<typeof metricsConfig>) => ({
            service: "atelier-backend",
            port: metrics.port,
          }),
        }),
        ValkeyModule.forRootAsync({
          inject: [valkeyConfig.KEY],
          useFactory: (valkey: ConfigType<typeof valkeyConfig>) => valkey,
        }),
        InfraModule,
        ...(api
          ? [
              DatabaseModule.forRootAsync({
                schema,
                service: "atelier-backend",
                inject: [dbConfig.KEY],
                useFactory: (db: ConfigType<typeof dbConfig>) => db,
              }),
              ...auth,
              ThrottlerModule.forRootAsync({
                inject: [ValkeyThrottlerStorage, httpConfig.KEY],
                useFactory: (
                  storage: ValkeyThrottlerStorage,
                  http: ConfigType<typeof httpConfig>,
                ) => ({
                  throttlers: [
                    {
                      name: "default",
                      ttl: 60_000,
                      limit: http.rateLimitPerMinute,
                    },
                  ],
                  storage,
                }),
              }),
              OrchestratorModule,
              ApiModule,
            ]
          : []),
        ...(worker ? [WorkerModule] : []),
      ],
      providers: api ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }] : [],
    };
  }
}

function AuthModuleFactory() {
  return AuthModule.forRootAsync({
    inject: [authConfig.KEY],
    useFactory: (async (auth: ConfigType<typeof authConfig>) => ({
      issuer: auth.issuer,
      audience: auth.audience,
      keys: await authKeys(auth),
    })) as never,
  });
}
