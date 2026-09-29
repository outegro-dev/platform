import { Controller, Get, Inject } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { Public } from "@outegro/nest-common";
import { checkoutConfig } from "../config/config.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../lava/provider.js";
import { CatalogService } from "./catalog.service.js";

/** What can be bought, and whether sales are open right now. */
@Public()
@Controller("catalog")
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    @Inject(checkoutConfig.KEY)
    private readonly config: ConfigType<typeof checkoutConfig>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Get()
  async list() {
    return {
      checkoutEnabled: this.config.enabled && this.provider.configured,
      products: await this.catalog.list(),
    };
  }
}
