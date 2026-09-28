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

export const authConfig = registerAs("auth", () => ({
  jwksUrl: env().AUTH_JWKS_URL,
  issuer: env().AUTH_ISSUER,
  audience: env().AUTH_AUDIENCE,
  internalToken: env().INTERNAL_API_TOKEN,
}));

export const channelsConfig = registerAs("channels", () => ({
  emailProvider: env().EMAIL_PROVIDER,
  smtpUrl: env().SMTP_URL,
  resendApiKey: env().RESEND_API_KEY,
  emailFrom: env().EMAIL_FROM,
  telegramBotToken: env().TELEGRAM_BOT_TOKEN,
  publicWebUrl: env().PUBLIC_WEB_URL,
}));
