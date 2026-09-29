import { registerAs } from "@nestjs/config";
import { env } from "./env.js";

export const dbConfig = registerAs("db", () => ({
  url: env().DATABASE_URL,
  max: env().DATABASE_POOL_MAX,
}));

export const valkeyConfig = registerAs("valkey", () => ({
  url: env().VALKEY_URL,
}));

export const rabbitConfig = registerAs("rabbit", () => ({
  url: env().RABBITMQ_URL,
}));

export const metricsConfig = registerAs("metrics", () => ({
  port: env().METRICS_PORT,
}));

export const authConfig = registerAs("auth", () => ({
  jwksUrl: env().AUTH_JWKS_URL,
  issuer: env().AUTH_ISSUER,
  audience: env().AUTH_AUDIENCE,
  internalUrl: env().AUTH_INTERNAL_URL,
  internalToken: env().INTERNAL_API_TOKEN,
}));

export const checkoutConfig = registerAs("checkout", () => {
  const payWeb = new URL(env().PAY_WEB_URL);
  return {
    enabled: env().CHECKOUT_ENABLED,
    defaultReturnUrl: new URL("/checkout/result", payWeb).toString(),
    returnOrigins: [
      ...new Set([
        payWeb.origin,
        ...env().CHECKOUT_RETURN_ORIGINS.map((o) => new URL(o).origin),
      ]),
    ],
  };
});

export const lavaConfig = registerAs("lava", () => ({
  baseUrl: env().LAVA_API_URL,
  apiKey: env().LAVA_API_KEY,
  webhookSecret: env().LAVA_WEBHOOK_SECRET,
  timeoutMs: env().LAVA_TIMEOUT_MS,
  paymentUrlHosts: env().LAVA_PAYMENT_URL_HOSTS,
}));

export const workersConfig = registerAs("workers", () => ({
  reconcileIntervalMs: env().RECONCILE_INTERVAL_MS,
  expiryIntervalMs: env().EXPIRY_INTERVAL_MS,
  /** Tests drive workers with tick(); the loops run only outside tests. */
  autoStart: env().NODE_ENV !== "test",
}));
