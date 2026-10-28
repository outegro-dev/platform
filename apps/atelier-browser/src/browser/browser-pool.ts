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
  timezoneId: "Asia/Tbilisi",
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  acceptDownloads: false,
} as const;

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

  async newContext(): Promise<BrowserContext> {
    this.browser ??= this.launch();
    const browser = await this.browser;
    return browser.newContext(CONTEXT_OPTIONS);
  }

  async onApplicationShutdown() {
    const browser = await this.browser?.catch(() => null);
    this.browser = null;
    await browser?.close().catch(() => {});
  }
}
