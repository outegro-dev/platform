import { type ConfigFactory, ConfigModule } from "@nestjs/config";
import { z } from "zod";

/** Variables every service has. */
export const baseEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
});

export const valkeyEnvSchema = z.object({
  VALKEY_URL: z.url({ protocol: /^rediss?$/ }),
});

export const rabbitEnvSchema = z.object({
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
});

/** Where services fetch the Identity public keys to verify access tokens. */
export const jwksEnvSchema = z.object({
  AUTH_JWKS_URL: z.url(),
  AUTH_ISSUER: z.string().min(1),
  AUTH_AUDIENCE: z.string().min(1),
});

/** Port of the separate Prometheus listener (`GET /metrics`); 0 turns it off. */
export const metricsEnvSchema = z.object({
  METRICS_PORT: z.coerce.number().int().min(0).max(65_535).default(9464),
});

/**
 * One validated view of process.env per service.
 *
 *   export const env = defineEnv(baseEnvSchema.extend({ ... }));
 *   export const dbConfig = registerAs("db", () => ({ url: env().DATABASE_URL }));
 *
 * No defaults for secrets: a missing key stops the service at startup
 * with the list of every invalid variable.
 */
export function defineEnv<S extends z.ZodObject>(schema: S) {
  let cached: z.infer<S> | undefined;
  const read = (): z.infer<S> => {
    if (cached) return cached;
    const result = schema.safeParse(process.env);
    if (!result.success) {
      const lines = result.error.issues.map(
        (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      );
      throw new Error(`Invalid environment:\n${lines.join("\n")}`);
    }
    cached = result.data;
    return cached;
  };
  return Object.assign(read, { schema, reset: () => (cached = undefined) });
}

/**
 * Global ConfigModule: validates with the service schema (Standard Schema,
 * Nest 12) and loads the typed `registerAs` groups.
 */
export function createConfigModule(
  env: ReturnType<typeof defineEnv>,
  load: ConfigFactory[] = [],
) {
  return ConfigModule.forRoot({
    isGlobal: true,
    cache: true,
    ignoreEnvFile: process.env.NODE_ENV === "production",
    validationSchema: env.schema,
    load,
  });
}
