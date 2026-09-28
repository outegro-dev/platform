import {
  baseEnvSchema,
  databaseEnvSchema,
  defineEnv,
  rabbitEnvSchema,
  valkeyEnvSchema,
} from "@outegro/nest-common";

/** Every variable auth-backend reads. Nothing else touches process.env. */
export const env = defineEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(valkeyEnvSchema.shape)
    .extend(rabbitEnvSchema.shape),
);
