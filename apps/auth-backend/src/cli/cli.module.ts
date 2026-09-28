import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  ClockModule,
  DatabaseModule,
  HealthModule,
  MessagingModule,
  OutboxModule,
} from "@outegro/nest-common";
import { RolesService } from "../access/roles.service.js";
import { dbConfig, rabbitConfig } from "../config/config.js";
import { AppConfigModule } from "../config/config.module.js";
import * as schema from "../db/schema.js";

/** Minimal context for operator commands: database and outbox only. */
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
    MessagingModule.forRootAsync({
      inject: [rabbitConfig.KEY],
      useFactory: (rabbit: ConfigType<typeof rabbitConfig>) => ({
        url: rabbit.url,
        service: "identity",
      }),
    }),
    OutboxModule.forRoot(),
  ],
  providers: [RolesService],
})
export class CliModule {}
