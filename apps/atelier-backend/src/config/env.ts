import {
  baseEnvSchema,
  defineEnv,
  metricsEnvSchema,
  rabbitEnvSchema,
  valkeyEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

/** Optional value: an empty `KEY=` line in .env means "not configured". */
const optional = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

export const roles = ["api", "worker"] as const;
export type Role = (typeof roles)[number];

/** `api`, `worker` or both (`api,worker`: one process in production). */
const roleList = z
  .string()
  .default("api")
  .transform((value, ctx) => {
    const list = [
      ...new Set(
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
    const unknown = list.filter((item) => !roles.includes(item as Role));
    if (!list.length || unknown.length) {
      ctx.addIssue({
        code: "custom",
        message: `ROLE must be a comma list of ${roles.join(", ")}`,
      });
      return z.NEVER;
    }
    return list as Role[];
  });

/** Every variable atelier-backend reads; what a role needs is checked below. */
export const envSchema = baseEnvSchema
  .extend(valkeyEnvSchema.shape)
  .extend(rabbitEnvSchema.shape)
  .extend(metricsEnvSchema.shape)
  .extend({
    ROLE: roleList,
    // The database belongs to the api role; a worker never touches it.
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    AUTH_JWKS_URL: z.url().optional(),
    AUTH_ISSUER: optional,
    AUTH_AUDIENCE: optional,
    /**
     * Local development only (NODE_ENV=development): verify access tokens with
     * the public keys in this JWKS file instead of AUTH_JWKS_URL. Written by
     * `node dist/tools/dev-token.js`.
     */
    DEV_AUTH_JWKS_FILE: optional,
    HTTP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(240),
    /** Bearer token for /v1/internal (CLIs, other services); 32+ characters. */
    ATELIER_INTERNAL_TOKEN: optional,

    /** Where public CV links point: https://cv.outegro.dev in production. */
    CV_PUBLIC_BASE_URL: z.url().default("http://localhost:4008/cv"),
    /** Signs the owner's device cookie, so their own opens are not counted. */
    CV_OWNER_COOKIE_SECRET: optional,
    /** Domain of that cookie (`.outegro.dev` in production); none locally. */
    CV_OWNER_COOKIE_DOMAIN: optional,

    /** `pg` keeps files in the `files` table; default when S3_ENDPOINT is unset. */
    STORAGE_DRIVER: z.enum(["s3", "pg"]).optional(),
    S3_ENDPOINT: optional,
    S3_BUCKET: z.string().trim().min(1).default("atelier"),
    S3_ACCESS_KEY_ID: optional,
    S3_SECRET_ACCESS_KEY: optional,
    S3_REGION: z.string().trim().min(1).default("auto"),
    /** Path-style URLs (MinIO); R2 takes virtual-host style as well. */
    S3_FORCE_PATH_STYLE: z.stringbool().default(true),

    LLM_GATEWAY_URL: z.url().default("http://localhost:4009"),
    LLM_GATEWAY_TOKEN: optional,
    /** Default model profile; LLM_PROFILE_<STEP> overrides it per step. */
    LLM_PROFILE_DEFAULT: z.string().trim().min(1).default("codex-sol-low"),
    LLM_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(3_600_000)
      .default(600_000),
    ATELIER_TEX_URL: z.url().default("http://localhost:4010"),
    ATELIER_TEX_TOKEN: optional,
    ATELIER_BROWSER_URL: z.url().default("http://localhost:4011"),
    ATELIER_BROWSER_TOKEN: optional,

    /** Task types this worker consumes (comma list); empty means all. */
    WORKER_TASKS: optional,
    /** Messages one worker process handles at once, per queue. */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    /** Attempts of one step before the job fails (quota pauses do not count). */
    STEP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
    /** When quota has no reset time: pause the step this long. */
    LLM_QUOTA_PAUSE_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(3600),
    /** Scheduler pass: deadlines, follow-ups, the daily tick (api role). */
    SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(3_600_000)
      .default(30_000),
    /** UTC hour of tick.daily. */
    TICK_DAILY_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  })
  .superRefine((value, ctx) => {
    const driver = value.STORAGE_DRIVER ?? (value.S3_ENDPOINT ? "s3" : "pg");
    if (driver === "pg" && !value.DATABASE_URL)
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "required for STORAGE_DRIVER=pg (files live in the database)",
      });
    if (driver === "s3")
      for (const key of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const)
        if (!value[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required for STORAGE_DRIVER=s3",
          });
    if (!value.ROLE.includes("api")) return;
    for (const key of ["DATABASE_URL", "AUTH_ISSUER", "AUTH_AUDIENCE"] as const)
      if (!value[key])
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "required for ROLE=api",
        });
    if (!value.AUTH_JWKS_URL && !value.DEV_AUTH_JWKS_FILE)
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_JWKS_URL"],
        message: "required for ROLE=api",
      });
    if (value.DEV_AUTH_JWKS_FILE && value.NODE_ENV !== "development")
      ctx.addIssue({
        code: "custom",
        path: ["DEV_AUTH_JWKS_FILE"],
        message: "allowed only with NODE_ENV=development",
      });
    if (
      value.ATELIER_INTERNAL_TOKEN &&
      value.ATELIER_INTERNAL_TOKEN.length < 32
    )
      ctx.addIssue({
        code: "custom",
        path: ["ATELIER_INTERNAL_TOKEN"],
        message: "at least 32 characters",
      });
  });

export const env = defineEnv(envSchema);
export type Env = ReturnType<typeof env>;

export const hasRole = (role: Role) => env().ROLE.includes(role);

/** The storage driver: explicit, or S3 when an endpoint is configured. */
export const storageDriver = (value: Env = env()) =>
  value.STORAGE_DRIVER ?? (value.S3_ENDPOINT ? "s3" : "pg");
