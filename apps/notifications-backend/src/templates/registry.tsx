import type { ReactElement } from "react";
import { Action, Code, Layout, Paragraph, Title } from "./layout.js";

export type Locale = "en" | "ru";
export type Category = "auth" | "security" | "billing" | "service";
export type Channel = "email" | "telegram" | "inbox";
type Data = Record<string, string | number | boolean | null>;
export type Context = { webUrl: string; accountUrl: string };

export type Template = {
  category: Category;
  /** Channels used when the requester does not narrow them. */
  channels: Channel[];
  /** Channels the user cannot switch off for this template. */
  mandatory: Channel[];
  /** How long an undelivered message is still worth sending. */
  ttlMs: number;
  /** Example data for admin previews; never real user data. */
  sample: Data;
  subject(locale: Locale, data: Data): string;
  title(locale: Locale, data: Data): string;
  /** Plain text for Telegram and the in-app inbox. */
  text(locale: Locale, data: Data): string;
  email(locale: Locale, data: Data, context: Context): ReactElement;
};

const footer = {
  en: "You receive this because you have an account at",
  ru: "Вы получили это письмо, потому что у вас есть аккаунт на",
};
const settings = (c: Context) => `${c.accountUrl}/account/notifications`;
const str = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);

const loginCode: Template = {
  category: "auth",
  channels: ["email"],
  mandatory: ["email"],
  ttlMs: 10 * 60_000,
  sample: { code: "482913", minutes: 10 },
  subject: (l, d) =>
    l === "ru"
      ? `Код входа: ${str(d.code)}`
      : `Your sign-in code: ${str(d.code)}`,
  title: (l) => (l === "ru" ? "Код входа" : "Sign-in code"),
  text: (l, d) =>
    l === "ru"
      ? `Код входа: ${str(d.code)}. Действует ${str(d.minutes)} мин.`
      : `Sign-in code: ${str(d.code)}. Valid for ${str(d.minutes)} min.`,
  email: (l, d, c) => (
    <Layout
      locale={l}
      preview={loginCode.subject(l, d)}
      footer={footer[l]}
      webUrl={c.webUrl}
    >
      <Title>{l === "ru" ? "Ваш код входа" : "Your sign-in code"}</Title>
      <Paragraph>
        {l === "ru"
          ? "Введите этот код на странице входа. Никому его не сообщайте."
          : "Enter this code on the sign-in page. Never share it with anyone."}
      </Paragraph>
      <Code value={str(d.code)} />
      <Paragraph>
        {l === "ru"
          ? `Код действует ${str(d.minutes)} минут. Если вы не запрашивали вход, просто проигнорируйте письмо.`
          : `The code is valid for ${str(d.minutes)} minutes. If you did not try to sign in, ignore this email.`}
      </Paragraph>
    </Layout>
  ),
};

const sessionRevoked: Template = {
  category: "security",
  channels: ["inbox", "email", "telegram"],
  mandatory: ["inbox", "email"],
  ttlMs: 24 * 3600_000,
  sample: { ip: "203.0.113.7" },
  subject: (l) =>
    l === "ru"
      ? "Сеанс завершён из соображений безопасности"
      : "A session was ended for your security",
  title: (l) => (l === "ru" ? "Сеанс завершён" : "Session ended"),
  text: (l, d) =>
    l === "ru"
      ? `Мы заметили повторное использование токена сеанса и завершили его${d.ip ? ` (IP ${str(d.ip)})` : ""}. Если это были не вы, войдите заново и завершите остальные сеансы.`
      : `We saw a session token being reused and ended that session${d.ip ? ` (IP ${str(d.ip)})` : ""}. If this was not you, sign in again and end your other sessions.`,
  email: (l, d, c) => (
    <Layout
      locale={l}
      preview={sessionRevoked.subject(l, d)}
      footer={footer[l]}
      webUrl={c.webUrl}
      settingsUrl={settings(c)}
    >
      <Title>{sessionRevoked.title(l, d)}</Title>
      <Paragraph>{sessionRevoked.text(l, d)}</Paragraph>
      <Action href={`${c.accountUrl}/account/sessions`}>
        {l === "ru" ? "Проверить сеансы" : "Review your sessions"}
      </Action>
    </Layout>
  ),
};

const serviceMessage: Template = {
  category: "service",
  channels: ["inbox", "email"],
  mandatory: ["inbox"],
  ttlMs: 3 * 24 * 3600_000,
  sample: {
    title: "Scheduled maintenance",
    body: "outegro.dev will be read-only for ten minutes tonight at 23:00 UTC.",
  },
  subject: (_l, d) => str(d.title),
  title: (_l, d) => str(d.title),
  text: (_l, d) => str(d.body),
  email: (l, d, c) => (
    <Layout
      locale={l}
      preview={str(d.title)}
      footer={footer[l]}
      webUrl={c.webUrl}
      settingsUrl={settings(c)}
    >
      <Title>{str(d.title)}</Title>
      <Paragraph>{str(d.body)}</Paragraph>
    </Layout>
  ),
};

const paymentConfirmed: Template = {
  category: "billing",
  channels: ["inbox", "email", "telegram"],
  mandatory: ["inbox"],
  ttlMs: 3 * 24 * 3600_000,
  sample: { product: "Battleship Premium", amount: "50 ₽" },
  subject: (l, d) =>
    l === "ru"
      ? `Оплата получена: ${str(d.product)}`
      : `Payment received: ${str(d.product)}`,
  title: (l) => (l === "ru" ? "Оплата получена" : "Payment received"),
  text: (l, d) =>
    l === "ru"
      ? `Мы получили оплату ${str(d.amount)} за «${str(d.product)}». Доступ уже открыт.`
      : `We received ${str(d.amount)} for “${str(d.product)}”. Your access is active.`,
  email: (l, d, c) => (
    <Layout
      locale={l}
      preview={paymentConfirmed.subject(l, d)}
      footer={footer[l]}
      webUrl={c.webUrl}
      settingsUrl={settings(c)}
    >
      <Title>{paymentConfirmed.title(l, d)}</Title>
      <Paragraph>{paymentConfirmed.text(l, d)}</Paragraph>
    </Layout>
  ),
};

/** Channel check an operator sends to their own address from the admin console. */
const serviceTest: Template = {
  category: "service",
  channels: ["email", "telegram"],
  mandatory: [],
  ttlMs: 3600_000,
  sample: { channel: "email" },
  subject: (l) =>
    l === "ru" ? "Проверка канала outegro.dev" : "outegro.dev channel check",
  title: (l) => (l === "ru" ? "Проверка канала" : "Channel check"),
  text: (l, d) =>
    l === "ru"
      ? `Тестовое сообщение из админки (${str(d.channel)}). Если вы его видите, канал работает.`
      : `A test message from the admin console (${str(d.channel)}). If you can read it, the channel works.`,
  email: (l, d, c) => (
    <Layout
      locale={l}
      preview={serviceTest.subject(l, d)}
      footer={footer[l]}
      webUrl={c.webUrl}
      settingsUrl={settings(c)}
    >
      <Title>{serviceTest.title(l, d)}</Title>
      <Paragraph>{serviceTest.text(l, d)}</Paragraph>
    </Layout>
  ),
};

export const templates: Record<string, Template> = {
  "auth.login-code": loginCode,
  "security.session-revoked": sessionRevoked,
  "service.message": serviceMessage,
  "service.test": serviceTest,
  "billing.payment-confirmed": paymentConfirmed,
};

export function templateFor(key: string) {
  const template = templates[key];
  if (!template) throw new Error(`Unknown template ${key}`);
  return template;
}
