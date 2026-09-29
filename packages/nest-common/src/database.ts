import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { createDatabase } from "@outegro/db";
import { HealthRegistry } from "./health.js";

export const DATABASE = Symbol("DATABASE");
const logger = new Logger("Database");

/** Inject with `@Inject(DATABASE) database: DatabaseHandle<typeof schema>`. */
export type DatabaseHandle<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> = ReturnType<typeof createDatabase<TSchema>>;

@Injectable()
class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    private readonly health: HealthRegistry,
  ) {}
  onModuleInit() {
    this.health.register("postgres", () => this.database.ping());
  }
  async onApplicationShutdown() {
    await this.database.close();
  }
}

@Global()
@Module({})
export class DatabaseModule {
  static forRootAsync<TSchema extends Record<string, unknown>>(options: {
    schema: TSchema;
    service: string;
    inject?: (string | symbol | (abstract new (...args: never[]) => unknown))[];
    useFactory: (...args: never[]) => { url: string; max?: number };
  }): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE,
          inject: options.inject ?? [],
          useFactory: (...args: never[]) =>
            createDatabase({
              ...options.useFactory(...args),
              schema: options.schema,
              applicationName: options.service,
              onIdleError: (error) =>
                logger.warn(
                  { err: error.message },
                  "Idle PostgreSQL connection lost; reconnecting on next use",
                ),
            }),
        },
        DatabaseLifecycle,
      ],
      exports: [DATABASE],
    };
  }
}
