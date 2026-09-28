import { Module } from "@nestjs/common";
import { createConfigModule } from "@outegro/nest-common";
import { appConfig, dbConfig, rabbitConfig, valkeyConfig } from "./config.js";
import { env } from "./env.js";

/** Global, validated configuration. Inject groups with `@Inject(dbConfig.KEY)`. */
@Module({
  imports: [
    createConfigModule(env, [appConfig, dbConfig, valkeyConfig, rabbitConfig]),
  ],
})
export class AppConfigModule {}
