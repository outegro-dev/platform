import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { type Browser, type BrowserContext, chromium } from "playwright";
import { browserConfig } from "../config/config.js";

/** Context settings of every request: one fresh context, nothing shared. */
export const CONTEXT_OPTIONS = {
  locale: "en-US",
  timezoneId: "UTC",
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  acceptDownloads: false,
} as const;

/**
 * An IANA zone for the profile's timezone: "GMT+4" → "Etc/GMT-4" (POSIX
 * signs are reversed), an IANA name as is, anything else (or a half-hour
 * offset) → UTC.
 */
export function timezoneOf(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  const offset = /^(?:gmt|utc)\s*([+-])\s*(\d{1,2})(?::?00)?$/i.exec(text);
  if (offset) {
    const hours = Number(offset[2]);
    if (hours === 0) return "UTC";
    if (hours <= 14) return `Etc/GMT${offset[1] === "+" ? "-" : "+"}${hours}`;
  }
  if (/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(text)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: text });
      return text;
    } catch {}
  }
  return "UTC";
}

/**
 * One headless Chromium for the process (plain Playwright, no stealth
 * patches); every request gets its own context, closed afterwards.
 */
@Injectable()
export class BrowserPool implements OnApplicationShutdown {
  private readonly logger = new Logger("BrowserPool");
  private browser: Promise<Browser> | null = null;

  constructor(
    @Inject(browserConfig.KEY)
    private readonly config: ConfigType<typeof browserConfig>,
  ) {}

  private launch(): Promise<Browser> {
    const launching = chromium
      .launch({ headless: this.config.headless })
      .then((browser) => {
        browser.on("disconnected", () => {
          if (this.browser === launching) this.browser = null;
          this.logger.warn("Chromium disconnected");
        });
        return browser;
      });
    launching.catch(() => {
      if (this.browser === launching) this.browser = null;
    });
    return launching;
  }

  async newContext(timezone?: string | null): Promise<BrowserContext> {
    this.browser ??= this.launch();
    const browser = await this.browser;
    return browser.newContext({
      ...CONTEXT_OPTIONS,
      timezoneId: timezoneOf(timezone),
    });
  }

  async onApplicationShutdown() {
    const browser = await this.browser?.catch(() => null);
    this.browser = null;
    await browser?.close().catch(() => {});
  }
}
