import type { ReactElement } from "react";
import { z } from "zod";
import { formatDateTime, formatMoney } from "./format.js";
import { Action, Code, Layout, Paragraph, Title } from "./layout.js";

export type Locale = "en" | "ru";
export type Category = "auth" | "security" | "billing" | "service";
export type Channel = "email" | "telegram" | "inbox";
type Data = Record<string, string | number | boolean | null>;
export type Context = { webUrl: string; accountUrl: string; payWebUrl: string };

export type Template = {
  category: Category;
  /** Channels used when the requester does not narrow them. */
  channels: Channel[];
  /** Channels the user cannot switch off for this template. */
  mandatory: Channel[];
  /** How long an undelivered message is still worth sending. */
  ttlMs: number;
  /** Shape of `data`, checked when the intent arrives (keys before N-06 have none). */
  schema?: z.ZodType<Data>;
  /** Example data for admin previews; never real user data. */
  sample: Data;
  subject(locale: Locale, data: Data): string;
  title(locale: Locale, data: Data): string;
  /** Plain text for Telegram and the in-app inbox. */
  text(locale: Locale, data: Data): string;
  email(locale: Locale, data: Data, context: Context): ReactElement;
};

const DAY_MS = 24 * 3600_000;
const footer = {
  en: "You receive this because you have an account at",
  ru: "Вы получили это письмо, потому что у вас есть аккаунт на",
};
const settings = (c: Context) => `${c.accountUrl}/account/notifications`;
const str = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);

/**
 * A link from intent data, only to our own sites: the scheme and host of the
 * public site, the account or pay-web, without credentials. Anything else is
 * null, so a message never carries someone else's redirect.
 */
export function allowedLink(value: unknown, c: Context) {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const origins = [c.webUrl, c.accountUrl, c.payWebUrl].map(
    (site) => new URL(site).origin,
  );
  if (url.username || url.password || !origins.includes(url.origin))
    return null;
  return url.toString();
}

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

/**
 * v1, as payments sent it before N-06: text only, no grant state. It stays
 * so stored messages still render, and claims nothing about access.
 */
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
      ? `Мы получили оплату ${str(d.amount)} за «${str(d.product)}».`
      : `We received ${str(d.amount)} for “${str(d.product)}”.`,
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

/*
 * Billing and security notices (N-06). They report facts their producer
 * committed in the same transaction as the request, and say about access
 * only what the data states. Keys carry a version: a new data shape is a
 * new key, and old keys stay for the messages already stored.
 */

/** Title, the text and one next step: the email of every notice. */
function notice(
  template: Omit<Template, "email"> & {
    action: {
      label: Record<Locale, string>;
      href: (d: Data, c: Context) => string;
    };
  },
): Template {
  const { action, ...rest } = template;
  return {
    ...rest,
    email: (l, d, c) => (
      <Layout
        locale={l}
        preview={rest.subject(l, d)}
        footer={footer[l]}
        webUrl={c.webUrl}
        settingsUrl={settings(c)}
      >
        <Title>{rest.title(l, d)}</Title>
        <Paragraph>{rest.text(l, d)}</Paragraph>
        <Action href={action.href(d, c)}>{action.label[l]}</Action>
      </Layout>
    ),
  };
}

const billing = {
  category: "billing",
  channels: ["inbox", "email", "telegram"],
  mandatory: ["inbox"],
  ttlMs: 3 * DAY_MS,
} satisfies Partial<Template>;
const security = {
  category: "security",
  channels: ["inbox", "email", "telegram"],
  mandatory: ["inbox", "email"],
  ttlMs: DAY_MS,
} satisfies Partial<Template>;

const iso = z.iso.datetime();
const productFields = {
  productEn: z.string().min(1).max(200),
  productRu: z.string().min(1).max(200),
};
const moneyFields = {
  amountMinor: z.string().regex(/^\d{1,20}$/),
  amountScale: z.number().int().min(0).max(4),
  currency: z.string().regex(/^[A-Z]{3}$/),
};
/** Whether the grant was in force when the payment was recorded (keys before withheld). */
const access = z.enum(["active", "pending"]);
/**
 * The grant as the payment left it: in force, not yet in force, or
 * withheld (revoked, or never granted as a duplicate) and never to open
 * from this payment, which the operator refunds.
 */
const grantAccess = z.enum(["active", "pending", "withheld"]);
/** A page of the recipient's own resource; its origin is checked on arrival. */
const actionUrl = z.string().max(2048);

const product = (l: Locale, d: Data) =>
  str(l === "ru" ? d.productRu : d.productEn);
const amount = (l: Locale, d: Data) =>
  formatMoney(str(d.amountMinor), str(d.currency), Number(d.amountScale), l);
const at = (l: Locale, value: unknown) => formatDateTime(str(value), l);
const linkOr = (d: Data, c: Context, fallback: string) =>
  allowedLink(d.actionUrl, c) ?? fallback;
const orderAction = {
  label: { en: "View order", ru: "Открыть заказ" },
  href: (d: Data, c: Context) => linkOr(d, c, `${c.payWebUrl}/orders`),
};
const subscriptionAction = {
  label: { en: "Manage subscription", ru: "Управлять подпиской" },
  href: (d: Data, c: Context) => linkOr(d, c, `${c.payWebUrl}/subscriptions`),
};

/** Not active yet (activation lags or was withheld): never promised. */
const pending = {
  en: "Access is not active yet: it opens once activation completes.",
  ru: "Доступ ещё не открыт: он откроется, когда завершится активация.",
};
const received = (l: Locale, d: Data) =>
  l === "ru"
    ? `Оплата ${amount(l, d)} за «${product(l, d)}» получена ${at(l, d.paidAt)}.`
    : `We received ${amount(l, d)} for “${product(l, d)}” on ${at(l, d.paidAt)}.`;
const subscriptionAccess = (l: Locale, d: Data) =>
  d.access !== "active"
    ? pending[l]
    : l === "ru"
      ? "Доступ открыт."
      : "Access is active.";
/** `accessUntil` null: the subscription's grant is not in force. */
const subscriptionInactive = {
  en: "Access from this subscription is not active.",
  ru: "Доступ по этой подписке не активен.",
};
/** Withheld: access will not open from this payment, and it is refunded. */
const withheld = {
  en: "This payment does not open access; we will refund it.",
  ru: "Этот платёж не открывает доступ, мы его вернём.",
};
const paymentSubject = (l: Locale, d: Data) =>
  l === "ru"
    ? `Оплата получена: ${product(l, d)}`
    : `Payment received: ${product(l, d)}`;
const paymentTitle = (l: Locale) =>
  l === "ru" ? "Оплата получена" : "Payment received";

/**
 * The next version of a receipt: `access` may also be withheld. Then the
 * message confirms the money and the refund, and nothing about the paid
 * period or renewal; otherwise it reads exactly as the previous version.
 */
function withWithheld(
  previous: Template,
  schema: z.ZodType<Data>,
  action: Parameters<typeof notice>[0]["action"],
): Template {
  return notice({
    ...billing,
    schema,
    sample: previous.sample,
    subject: (l, d) =>
      d.access === "withheld" ? paymentSubject(l, d) : previous.subject(l, d),
    title: (l, d) =>
      d.access === "withheld" ? paymentTitle(l) : previous.title(l, d),
    text: (l, d) =>
      d.access === "withheld"
        ? `${received(l, d)} ${withheld[l]}`
        : previous.text(l, d),
    action,
  });
}

const purchaseFields = {
  ...productFields,
  ...moneyFields,
  paidAt: iso,
  /** null with active access: no end date. */
  accessUntil: iso.nullable(),
  actionUrl,
};
const subscriptionPaymentFields = {
  ...productFields,
  ...moneyFields,
  paidAt: iso,
  paidUntil: iso,
  actionUrl,
};

/** A one-time purchase was paid. */
const paymentReceived = notice({
  ...billing,
  schema: z.object({ ...purchaseFields, access }),
  sample: {
    productEn: "Silver Fleet",
    productRu: "Серебряный флот",
    amountMinor: "5000",
    amountScale: 2,
    currency: "RUB",
    paidAt: "2026-09-29T14:03:00.000Z",
    access: "active",
    accessUntil: null,
    actionUrl:
      "https://pay.outegro.dev/orders/00000000-0000-4000-8000-000000000001",
  },
  subject: paymentSubject,
  title: paymentTitle,
  text: (l, d) => {
    const until = d.accessUntil ? at(l, d.accessUntil) : null;
    const state =
      d.access !== "active"
        ? pending[l]
        : l === "ru"
          ? until
            ? `Доступ открыт до ${until}.`
            : "Доступ открыт бессрочно."
          : until
            ? `Access is active until ${until}.`
            : "Access is active with no end date.";
    return `${received(l, d)} ${state}`;
  },
  action: orderAction,
});

const subscriptionStarted = notice({
  ...billing,
  schema: z.object({ ...subscriptionPaymentFields, access }),
  sample: {
    productEn: "Battleship Premium",
    productRu: "Морской бой Premium",
    amountMinor: "5000",
    amountScale: 2,
    currency: "RUB",
    paidAt: "2026-09-29T14:03:00.000Z",
    paidUntil: "2026-10-29T14:03:00.000Z",
    access: "active",
    actionUrl: "https://pay.outegro.dev/subscriptions",
  },
  subject: (l, d) =>
    l === "ru"
      ? `Подписка оформлена: ${product(l, d)}`
      : `Subscription started: ${product(l, d)}`,
  title: (l) => (l === "ru" ? "Подписка оформлена" : "Subscription started"),
  text: (l, d) =>
    l === "ru"
      ? `${received(l, d)} Подписка оплачена до ${at(l, d.paidUntil)} и продлевается автоматически. ${subscriptionAccess(l, d)}`
      : `${received(l, d)} The subscription is paid until ${at(l, d.paidUntil)} and renews automatically. ${subscriptionAccess(l, d)}`,
  action: subscriptionAction,
});

const subscriptionRenewed = notice({
  ...billing,
  schema: z.object({ ...subscriptionPaymentFields, access }),
  sample: {
    productEn: "Battleship Premium",
    productRu: "Морской бой Premium",
    amountMinor: "59",
    amountScale: 2,
    currency: "USD",
    paidAt: "2026-10-29T14:03:00.000Z",
    paidUntil: "2026-11-29T14:03:00.000Z",
    access: "active",
    actionUrl: "https://pay.outegro.dev/subscriptions",
  },
  subject: (l, d) =>
    l === "ru"
      ? `Подписка продлена: ${product(l, d)}`
      : `Subscription renewed: ${product(l, d)}`,
  title: (l) => (l === "ru" ? "Подписка продлена" : "Subscription renewed"),
  text: (l, d) =>
    l === "ru"
      ? `${received(l, d)} Теперь подписка оплачена до ${at(l, d.paidUntil)}. ${subscriptionAccess(l, d)}`
      : `${received(l, d)} The subscription is now paid until ${at(l, d.paidUntil)}. ${subscriptionAccess(l, d)}`,
  action: subscriptionAction,
});

/*
 * Receipts whose grant may also be withheld: before, a revoked grant was
 * sent as `pending` and read as access still to open. The keys above stay
 * for the messages already stored.
 */
const paymentReceivedV3 = withWithheld(
  paymentReceived,
  z.object({ ...purchaseFields, access: grantAccess }),
  orderAction,
);
const subscriptionStartedV2 = withWithheld(
  subscriptionStarted,
  z.object({ ...subscriptionPaymentFields, access: grantAccess }),
  subscriptionAction,
);
const subscriptionRenewedV2 = withWithheld(
  subscriptionRenewed,
  z.object({ ...subscriptionPaymentFields, access: grantAccess }),
  subscriptionAction,
);

/** The provider reported a failed renewal charge. */
const renewalFailed = notice({
  ...billing,
  schema: z.object({
    ...productFields,
    accessUntil: iso.nullable(),
    actionUrl,
  }),
  sample: {
    productEn: "Battleship Premium",
    productRu: "Морской бой Premium",
    accessUntil: "2026-11-01T14:03:00.000Z",
    actionUrl: "https://pay.outegro.dev/subscriptions",
  },
  subject: (l, d) =>
    l === "ru"
      ? `Продление не оплачено: ${product(l, d)}`
      : `Renewal payment failed: ${product(l, d)}`,
  title: (l) =>
    l === "ru" ? "Продление не оплачено" : "Renewal payment failed",
  text: (l, d) => {
    const failed =
      l === "ru"
        ? `Платёж за продление «${product(l, d)}» не прошёл.`
        : `The payment to renew “${product(l, d)}” did not go through.`;
    if (!d.accessUntil) return `${failed} ${subscriptionInactive[l]}`;
    return l === "ru"
      ? `${failed} Доступ сохранится до ${at(l, d.accessUntil)}; если оплата не поступит, он закончится.`
      : `${failed} Access stays active until ${at(l, d.accessUntil)} and ends then unless a payment arrives.`;
  },
  action: subscriptionAction,
});

/** The provider confirmed that renewal is off; paid time is kept. */
const subscriptionCancelled = notice({
  ...billing,
  schema: z.object({
    ...productFields,
    accessUntil: iso.nullable(),
    actionUrl,
  }),
  sample: {
    productEn: "Battleship Premium",
    productRu: "Морской бой Premium",
    accessUntil: "2026-11-01T14:03:00.000Z",
    actionUrl: "https://pay.outegro.dev/subscriptions",
  },
  subject: (l, d) =>
    l === "ru"
      ? `Автопродление отключено: ${product(l, d)}`
      : `Renewal turned off: ${product(l, d)}`,
  title: (l) => (l === "ru" ? "Автопродление отключено" : "Renewal turned off"),
  text: (l, d) => {
    const left = !d.accessUntil
      ? subscriptionInactive[l]
      : l === "ru"
        ? `Доступ сохранится до ${at(l, d.accessUntil)}.`
        : `Access stays active until ${at(l, d.accessUntil)}.`;
    return l === "ru"
      ? `Автопродление «${product(l, d)}» отключено: новых списаний не будет. ${left}`
      : `Renewal of “${product(l, d)}” is off: no further payments will be taken. ${left}`;
  },
  action: subscriptionAction,
});

/** Paid time and grace are over. */
const subscriptionExpired = notice({
  ...billing,
  schema: z.object({ ...productFields, endedAt: iso, actionUrl }),
  sample: {
    productEn: "Battleship Premium",
    productRu: "Морской бой Premium",
    endedAt: "2026-11-01T14:03:00.000Z",
    actionUrl: "https://pay.outegro.dev/subscriptions",
  },
  subject: (l, d) =>
    l === "ru"
      ? `Подписка закончилась: ${product(l, d)}`
      : `Subscription ended: ${product(l, d)}`,
  title: (l) => (l === "ru" ? "Подписка закончилась" : "Subscription ended"),
  text: (l, d) =>
    l === "ru"
      ? `Подписка «${product(l, d)}» закончилась: доступ по ней закрыт ${at(l, d.endedAt)}. Оформить её снова можно в любой момент.`
      : `The subscription to “${product(l, d)}” has ended: access from it closed on ${at(l, d.endedAt)}. You can subscribe again at any time.`,
  action: subscriptionAction,
});

/** The refund, then what it left of the purchase's access. */
const refunded = (l: Locale, d: Data, left: string) =>
  l === "ru"
    ? `Мы учли возврат ${amount(l, d)} за «${product(l, d)}». ${left}`
    : `We recorded a refund of ${amount(l, d)} for “${product(l, d)}”. ${left}`;
const refundEnded = {
  en: "Access from this purchase has ended.",
  ru: "Доступ по этой покупке закрыт.",
};
const refundKeepsUntil = (l: Locale, until: unknown) =>
  l === "ru"
    ? `Доступ по этой покупке сохранится до ${at(l, until)}.`
    : `Access from this purchase stays active until ${at(l, until)}.`;
const refundSubject = (l: Locale, d: Data) =>
  l === "ru"
    ? `Возврат учтён: ${product(l, d)}`
    : `Refund recorded: ${product(l, d)}`;
const refundTitle = (l: Locale) =>
  l === "ru" ? "Возврат учтён" : "Refund recorded";

/**
 * v1: a refund applied to a verified payment. Any grant not in force reads
 * as ended, even one a duplicate purchase never opened; it stays for the
 * messages already stored.
 */
const refundRecorded = notice({
  ...billing,
  schema: z.object({
    ...productFields,
    ...moneyFields,
    accessUntil: iso.nullable(),
    actionUrl,
  }),
  sample: {
    productEn: "Silver Fleet",
    productRu: "Серебряный флот",
    amountMinor: "52",
    amountScale: 2,
    currency: "EUR",
    accessUntil: null,
    actionUrl:
      "https://pay.outegro.dev/orders/00000000-0000-4000-8000-000000000001",
  },
  subject: refundSubject,
  title: refundTitle,
  // null: the grant of this purchase is no longer in force.
  text: (l, d) =>
    refunded(
      l,
      d,
      d.accessUntil ? refundKeepsUntil(l, d.accessUntil) : refundEnded[l],
    ),
  action: orderAction,
});

/**
 * What a refund left of the purchase's access: still in force (until
 * `accessUntil`, or with no end), ended, or withheld: the refunded payment
 * never opened any (a duplicate purchase, a renewal charged after a
 * revoke), so nothing ended and only the money goes back.
 */
const refundAccess = z.enum(["active", "ended", "withheld"]);
const refundOpenedNothing = {
  en: "This payment did not open any access; the money is on its way back.",
  ru: "Этот платёж не открывал никакого доступа, деньги уже возвращаются к вам.",
};
const refundKeeps = {
  en: "Access from this purchase stays active.",
  ru: "Доступ по этой покупке сохраняется.",
};

/** v2: v1 with the access state; ended and active read as v1 did. */
const refundRecordedV2 = notice({
  ...billing,
  schema: z.object({
    ...productFields,
    ...moneyFields,
    access: refundAccess,
    /** The end of access still in force; null when it has none or is over. */
    accessUntil: iso.nullable(),
    actionUrl,
  }),
  sample: { ...refundRecorded.sample, access: "ended" },
  subject: refundSubject,
  title: refundTitle,
  text: (l, d) =>
    refunded(
      l,
      d,
      d.access === "withheld"
        ? refundOpenedNothing[l]
        : d.access !== "active"
          ? refundEnded[l]
          : d.accessUntil
            ? refundKeepsUntil(l, d.accessUntil)
            : refundKeeps[l],
    ),
  action: orderAction,
});

const securitySample = { at: "2026-09-29T14:03:00.000Z" };
const whenSchema = z.object({ at: iso });

const googleLinked = notice({
  ...security,
  schema: whenSchema,
  sample: securitySample,
  subject: (l) =>
    l === "ru"
      ? "К аккаунту добавлен вход через Google"
      : "Google sign-in was added to your account",
  title: (l) =>
    l === "ru" ? "Добавлен вход через Google" : "Google sign-in added",
  text: (l, d) =>
    l === "ru"
      ? `К вашему аккаунту outegro.dev привязан аккаунт Google (${at(l, d.at)}), теперь с ним можно входить. Если это были не вы, отвяжите его в разделе «Безопасность» и завершите остальные сеансы.`
      : `A Google account was linked to your outegro.dev account on ${at(l, d.at)} and can now be used to sign in. If this was not you, unlink it under Security and end your other sessions.`,
  action: {
    label: { en: "Review sign-in methods", ru: "Проверить способы входа" },
    href: (_d, c) => `${c.accountUrl}/account/security`,
  },
});

const googleUnlinked = notice({
  ...security,
  schema: whenSchema,
  sample: securitySample,
  subject: (l) =>
    l === "ru"
      ? "Вход через Google отвязан от аккаунта"
      : "Google sign-in was removed from your account",
  title: (l) =>
    l === "ru" ? "Вход через Google отвязан" : "Google sign-in removed",
  text: (l, d) =>
    l === "ru"
      ? `Аккаунт Google отвязан от вашего аккаунта outegro.dev (${at(l, d.at)}). Если это были не вы, войдите по почте и проверьте сеансы.`
      : `The Google account was unlinked from your outegro.dev account on ${at(l, d.at)}. If this was not you, sign in with your email and review your sessions.`,
  action: {
    label: { en: "Review your sessions", ru: "Проверить сеансы" },
    href: (_d, c) => `${c.accountUrl}/account/sessions`,
  },
});

/** Told by email, not in the chat that was just linked. */
const telegramLinked = notice({
  ...security,
  channels: ["inbox", "email"],
  schema: whenSchema,
  sample: securitySample,
  subject: (l) =>
    l === "ru"
      ? "К аккаунту подключён Telegram"
      : "Telegram was connected to your account",
  title: (l) => (l === "ru" ? "Telegram подключён" : "Telegram connected"),
  text: (l, d) =>
    l === "ru"
      ? `К вашему аккаунту outegro.dev подключён чат Telegram (${at(l, d.at)}), уведомления будут приходить и туда. Если это были не вы, отключите его в настройках уведомлений.`
      : `A Telegram chat was connected to your outegro.dev account on ${at(l, d.at)}, and notifications will arrive there too. If this was not you, disconnect it in notification settings.`,
  action: {
    label: { en: "Notification settings", ru: "Настройки уведомлений" },
    href: (_d, c) => settings(c),
  },
});

export const templates: Record<string, Template> = {
  "auth.login-code": loginCode,
  "security.session-revoked": sessionRevoked,
  "security.google-linked.v1": googleLinked,
  "security.google-unlinked.v1": googleUnlinked,
  "security.telegram-linked.v1": telegramLinked,
  "service.message": serviceMessage,
  "service.test": serviceTest,
  "billing.payment-confirmed": paymentConfirmed,
  "billing.payment-confirmed.v2": paymentReceived,
  "billing.payment-confirmed.v3": paymentReceivedV3,
  "billing.subscription-started.v1": subscriptionStarted,
  "billing.subscription-started.v2": subscriptionStartedV2,
  "billing.subscription-renewed.v1": subscriptionRenewed,
  "billing.subscription-renewed.v2": subscriptionRenewedV2,
  "billing.renewal-failed.v1": renewalFailed,
  "billing.subscription-cancelled.v1": subscriptionCancelled,
  "billing.subscription-expired.v1": subscriptionExpired,
  "billing.refund-recorded.v1": refundRecorded,
  "billing.refund-recorded.v2": refundRecordedV2,
};

export function templateFor(key: string) {
  const template = templates[key];
  if (!template) throw new Error(`Unknown template ${key}`);
  return template;
}
