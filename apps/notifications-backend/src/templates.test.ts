import { describe, expect, it } from "vitest";
import { redact } from "./admin/admin.controller.js";
import { formatDateTime, formatMoney } from "./templates/format.js";
import { allowedLink, type Locale, templates } from "./templates/registry.js";
import { renderEmail } from "./templates/render.js";

const context = {
  webUrl: "https://outegro.dev",
  accountUrl: "https://id.outegro.dev",
  payWebUrl: "https://pay.outegro.dev",
};
// ICU puts no-break spaces in amounts and times; compare words.
const plain = (text: string) => text.replace(/\s+/g, " ").trim();
const locales: Locale[] = ["en", "ru"];

describe("money and dates", () => {
  it.each([
    ["5000", "RUB", "en", "₽50.00"],
    ["5000", "RUB", "ru", "50,00 ₽"],
    ["59", "USD", "en", "$0.59"],
    ["59", "USD", "ru", "0,59 $"],
    ["52", "EUR", "en", "€0.52"],
    ["52", "EUR", "ru", "0,52 €"],
  ] as const)(
    "%s minor units of %s in %s read %s",
    (minor, currency, locale, expected) => {
      expect(plain(formatMoney(minor, currency, 2, locale))).toBe(expected);
    },
  );

  it("stays exact beyond Number.MAX_SAFE_INTEGER and follows the given scale", () => {
    expect(formatMoney("123456789012345678901", "USD", 2, "en")).toBe(
      "$1,234,567,890,123,456,789.01",
    );
    expect(formatMoney("1200", "JPY", 0, "en")).toBe("¥1,200");
  });

  it("writes times in UTC, says so, and speaks the reader's language", () => {
    const late = "2026-09-29T21:30:00.000Z";
    expect(plain(formatDateTime(late, "en"))).toBe("Sep 29, 2026, 9:30 PM UTC");
    expect(plain(formatDateTime(late, "ru"))).toBe("29 сент. 2026, 21:30 UTC");
  });
});

describe("templates", () => {
  it("every template has sample data it accepts itself", () => {
    for (const [key, template] of Object.entries(templates)) {
      const result = template.schema?.safeParse(template.sample);
      expect(result?.success ?? true, key).toBe(true);
    }
  });

  it("C2.4: what each template says, in English and Russian", async () => {
    const said: Record<string, unknown> = {};
    for (const [key, template] of Object.entries(templates)) {
      // Receipts that take a withheld grant say so as well.
      const withheld = {
        ...template.sample,
        access: "withheld",
        ...("accessUntil" in template.sample ? { accessUntil: null } : {}),
      };
      const variants = [
        [key, template.sample],
        ...("access" in template.sample &&
        template.schema?.safeParse(withheld).success
          ? [[`${key} withheld`, withheld] as const]
          : []),
      ] as const;
      for (const [name, data] of variants)
        for (const locale of locales) {
          const email = await renderEmail(key, locale, data, context);
          said[`${name} ${locale}`] = {
            subject: plain(email.subject),
            title: plain(template.title(locale, data)),
            text: plain(template.text(locale, data)),
            links: [...email.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]),
          };
        }
    }
    expect(said).toMatchSnapshot();
  });

  it("C2.4: operators see billing notices whole and security ones without the IP", () => {
    for (const [key, template] of Object.entries(templates)) {
      if (template.category === "billing")
        expect(redact("billing", template.sample), key).toEqual(
          template.sample,
        );
    }
    expect(
      redact("security", templates["security.session-revoked"]?.sample ?? {}),
    ).toEqual({ ip: "[redacted]" });
  });
});

describe("TC-N-06-02: access that is not active yet is never promised", () => {
  const payment = templates["billing.payment-confirmed.v2"];
  const started = templates["billing.subscription-started.v1"];
  if (!payment || !started) throw new Error("missing templates");

  it("says the payment arrived and access is still being activated", () => {
    const data = { ...payment.sample, access: "pending", accessUntil: null };
    expect(plain(payment.text("en", data))).toBe(
      "We received ₽50.00 for “Silver Fleet” on Sep 29, 2026, 2:03 PM UTC. Access is not active yet: it opens once activation completes.",
    );
    expect(plain(payment.text("ru", data))).toBe(
      "Оплата 50,00 ₽ за «Серебряный флот» получена 29 сент. 2026, 14:03 UTC. Доступ ещё не открыт: он откроется, когда завершится активация.",
    );
    const subscription = { ...started.sample, access: "pending" };
    expect(started.text("en", subscription)).not.toContain("Access is active");
    expect(started.text("ru", subscription)).not.toContain("Доступ открыт");
    expect(started.text("en", subscription)).toContain(
      "Access is not active yet",
    );
  });

  it("states access only as the grant stood: active, with or without an end", () => {
    expect(plain(payment.text("en", payment.sample))).toContain(
      "Access is active with no end date.",
    );
    const until = {
      ...payment.sample,
      accessUntil: "2026-10-29T14:03:00.000Z",
    };
    expect(plain(payment.text("ru", until))).toContain(
      "Доступ открыт до 29 окт. 2026, 14:03 UTC.",
    );
  });

  it("the v1 payment message, which carries no grant state, claims nothing", () => {
    const legacy = templates["billing.payment-confirmed"];
    if (!legacy) throw new Error("missing template");
    for (const locale of locales) {
      const text = legacy.text(locale, legacy.sample);
      expect(text).not.toMatch(/access|доступ/i);
    }
  });
});

describe("TC-N-06-02: access that will not open is never promised", () => {
  const withheld = [
    {
      key: "billing.payment-confirmed.v3",
      subject: [
        "Payment received: Silver Fleet",
        "Оплата получена: Серебряный флот",
      ],
      text: [
        "We received ₽50.00 for “Silver Fleet” on Sep 29, 2026, 2:03 PM UTC. This payment does not open access; we will refund it.",
        "Оплата 50,00 ₽ за «Серебряный флот» получена 29 сент. 2026, 14:03 UTC. Этот платёж не открывает доступ, мы его вернём.",
      ],
    },
    {
      key: "billing.subscription-started.v2",
      subject: [
        "Payment received: Battleship Premium",
        "Оплата получена: Морской бой Premium",
      ],
      text: [
        "We received ₽50.00 for “Battleship Premium” on Sep 29, 2026, 2:03 PM UTC. This payment does not open access; we will refund it.",
        "Оплата 50,00 ₽ за «Морской бой Premium» получена 29 сент. 2026, 14:03 UTC. Этот платёж не открывает доступ, мы его вернём.",
      ],
    },
    {
      key: "billing.subscription-renewed.v2",
      subject: [
        "Payment received: Battleship Premium",
        "Оплата получена: Морской бой Premium",
      ],
      text: [
        "We received $0.59 for “Battleship Premium” on Oct 29, 2026, 2:03 PM UTC. This payment does not open access; we will refund it.",
        "Оплата 0,59 $ за «Морской бой Premium» получена 29 окт. 2026, 14:03 UTC. Этот платёж не открывает доступ, мы его вернём.",
      ],
    },
  ];

  it.each(withheld)(
    "$key: a revoked or never granted access says it stays closed and the payment is refunded",
    ({ key, subject, text }) => {
      const template = templates[key];
      if (!template) throw new Error(`missing ${key}`);
      const data = {
        ...template.sample,
        access: "withheld",
        ...("accessUntil" in template.sample ? { accessUntil: null } : {}),
      };
      expect(template.schema?.safeParse(data).success).toBe(true);
      locales.forEach((locale, i) => {
        expect(plain(template.subject(locale, data))).toBe(subject[i]);
        expect(plain(template.text(locale, data))).toBe(text[i]);
      });
      expect(template.title("en", data)).toBe("Payment received");
      expect(template.title("ru", data)).toBe("Оплата получена");
    },
  );

  it("the new keys read as before while access is active or pending", () => {
    const pairs = [
      ["billing.payment-confirmed.v2", "billing.payment-confirmed.v3"],
      ["billing.subscription-started.v1", "billing.subscription-started.v2"],
      ["billing.subscription-renewed.v1", "billing.subscription-renewed.v2"],
    ] as const;
    for (const [before, after] of pairs) {
      const old = templates[before];
      const next = templates[after];
      if (!old || !next) throw new Error(`missing ${before} or ${after}`);
      for (const access of ["active", "pending"])
        for (const locale of locales) {
          const data = { ...old.sample, access };
          expect(next.schema?.safeParse(data).success, after).toBe(true);
          expect(next.subject(locale, data)).toBe(old.subject(locale, data));
          expect(next.text(locale, data)).toBe(old.text(locale, data));
        }
    }
  });

  it("the old keys, kept for stored messages, never took withheld", () => {
    for (const key of [
      "billing.payment-confirmed.v2",
      "billing.subscription-started.v1",
      "billing.subscription-renewed.v1",
    ]) {
      const template = templates[key];
      if (!template) throw new Error(`missing ${key}`);
      const data = { ...template.sample, access: "withheld" };
      expect(template.schema?.safeParse(data).success, key).toBe(false);
    }
  });
});

describe("TC-N-06-02: a refund says what it left of access, and only that", () => {
  const v1 = templates["billing.refund-recorded.v1"];
  const v2 = templates["billing.refund-recorded.v2"];
  if (!v1 || !v2) throw new Error("missing refund templates");
  const withState = (access: string, accessUntil: string | null = null) => ({
    ...v1.sample,
    access,
    accessUntil,
  });

  it("a payment that never opened access (a duplicate) is not told its access ended", () => {
    const data = withState("withheld");
    expect(v2.schema?.safeParse(data).success).toBe(true);
    expect(plain(v2.text("en", data))).toBe(
      "We recorded a refund of €0.52 for “Silver Fleet”. This payment did not open any access; the money is on its way back.",
    );
    expect(plain(v2.text("ru", data))).toBe(
      "Мы учли возврат 0,52 € за «Серебряный флот». Этот платёж не открывал никакого доступа, деньги уже возвращаются к вам.",
    );
    expect(v2.text("en", data)).not.toMatch(/ended|active/i);
    expect(v2.text("ru", data)).not.toMatch(/закрыт|сохранится/i);
    for (const locale of locales) {
      expect(v2.subject(locale, data)).toBe(v1.subject(locale, v1.sample));
      expect(v2.title(locale, data)).toBe(v1.title(locale, v1.sample));
    }
  });

  it("access that ended or stays reads exactly as the previous version", () => {
    const until = "2026-10-29T14:03:00.000Z";
    for (const locale of locales) {
      expect(v2.text(locale, withState("ended"))).toBe(
        v1.text(locale, { ...v1.sample, accessUntil: null }),
      );
      expect(v2.text(locale, withState("active", until))).toBe(
        v1.text(locale, { ...v1.sample, accessUntil: until }),
      );
    }
    expect(plain(v2.text("en", withState("active", until)))).toContain(
      "Access from this purchase stays active until Oct 29, 2026, 2:03 PM UTC.",
    );
  });

  it("access still in force with no end is never called ended", () => {
    const data = withState("active");
    expect(plain(v2.text("en", data))).toBe(
      "We recorded a refund of €0.52 for “Silver Fleet”. Access from this purchase stays active.",
    );
    expect(plain(v2.text("ru", data))).toBe(
      "Мы учли возврат 0,52 € за «Серебряный флот». Доступ по этой покупке сохраняется.",
    );
  });

  it("takes only the known states; v1 stays for the messages already stored", () => {
    expect(v2.schema?.safeParse(withState("pending")).success).toBe(false);
    expect(v2.schema?.safeParse(v1.sample).success).toBe(false);
    expect(v1.schema?.safeParse(v1.sample).success).toBe(true);
    for (const locale of locales)
      expect(plain(v1.text(locale, v1.sample))).toMatch(/has ended|закрыт/);
  });
});

describe("TC-N-06-03: links and hostile text", () => {
  it("allows links only to our own sites, with the same scheme and no credentials", () => {
    const own = "https://pay.outegro.dev/orders/42?x=1";
    expect(allowedLink(own, context)).toBe(own);
    expect(allowedLink("https://id.outegro.dev/account", context)).toBe(
      "https://id.outegro.dev/account",
    );
    for (const url of [
      "https://evil.example/orders",
      "https://pay.outegro.dev.evil.example/orders",
      "https://evil.example\\@pay.outegro.dev/orders",
      "https://user:pw@pay.outegro.dev/orders",
      "http://pay.outegro.dev/orders",
      "javascript:alert(1)",
      "//evil.example/x",
      "/orders",
      42,
      null,
    ])
      expect(allowedLink(url, context), String(url)).toBeNull();
  });

  it("renders a foreign link as the safe default and escapes HTML in names", async () => {
    const template = templates["billing.payment-confirmed.v2"];
    if (!template) throw new Error("missing template");
    const hostile = '<img src=x onerror="alert(1)">Fleet';
    const email = await renderEmail(
      "billing.payment-confirmed.v2",
      "en",
      {
        ...template.sample,
        productEn: hostile,
        actionUrl: "https://evil.example/phish",
      },
      context,
    );
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img src=x onerror=");
    expect(email.html).not.toContain("evil.example");
    expect(email.html).toContain('href="https://pay.outegro.dev/orders"');
    // The subject is a header, not HTML: the name stays as text.
    expect(email.subject).toBe(`Payment received: ${hostile}`);
  });
});
