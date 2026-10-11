import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  ClockModule,
  DatabaseModule,
  HealthModule,
} from "@outegro/nest-common";
import { RolesService } from "../access/roles.service.js";
import { dbConfig } from "../config/config.js";
import { AppConfigModule } from "../config/config.module.js";
import * as schema from "../db/schema.js";

/**
 * Minimal context for operator commands: the database only. Commands write
 * their events to the outbox in the same transaction, and the running
 * service's relay publishes them. No RabbitMQ here: a short command closed
 * while its channel was still being set up crashed with exit code 1 after
 * the change had committed ("grant-owner failed" in TC-R-02-01).
 */
@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    HealthModule,
    DatabaseModule.forRootAsync({
      schema,
      service: "auth-backend-cli",
      inject: [dbConfig.KEY],
      useFactory: (db: ConfigType<typeof dbConfig>) => ({
        url: db.url,
        max: 2,
      }),
    }),
  ],
  providers: [RolesService],
})
export class CliModule {}
