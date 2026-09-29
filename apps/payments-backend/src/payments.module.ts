import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { AccountController } from "./account/account.controller.js";
import { AccountService } from "./account/account.service.js";
import { AdminController } from "./admin/admin.controller.js";
import { AdminService } from "./admin/admin.service.js";
import { CurrentAccessGuard } from "./admin/current-access.guard.js";
import { CancellationService } from "./billing/cancellation.js";
import { GrantLedger } from "./billing/grants.js";
import { IssueRegistry } from "./billing/issues.js";
import { ProviderEvents } from "./billing/provider-events.js";
import { RefundService } from "./billing/refunds.js";
import { SettlementService } from "./billing/settlement.js";
import { CatalogController } from "./catalog/catalog.controller.js";
import { CatalogService } from "./catalog/catalog.service.js";
import { CheckoutController } from "./checkout/checkout.controller.js";
import { CheckoutService } from "./checkout/checkout.service.js";
import { lavaConfig } from "./config/config.js";
import { CustomersService } from "./customers/customers.service.js";
import {
  LavaPaymentProvider,
  UnconfiguredPaymentProvider,
} from "./lava/lava.provider.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./lava/provider.js";
import { LavaWebhookController } from "./lava/webhook.controller.js";
import { LavaWebhookGuard } from "./lava/webhook.guard.js";
import { ExpiryWorker } from "./workers/expiry.worker.js";
import { ReconciliationWorker } from "./workers/reconciliation.worker.js";

@Module({
  controllers: [
    CatalogController,
    CheckoutController,
    AccountController,
    AdminController,
    LavaWebhookController,
  ],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [lavaConfig.KEY],
      useFactory: (lava: ConfigType<typeof lavaConfig>): PaymentProvider =>
        lava.apiKey
          ? new LavaPaymentProvider({
              baseUrl: lava.baseUrl,
              apiKey: lava.apiKey,
              timeoutMs: lava.timeoutMs,
              paymentUrlHosts: lava.paymentUrlHosts,
            })
          : new UnconfiguredPaymentProvider(),
    },
    CatalogService,
    CustomersService,
    GrantLedger,
    IssueRegistry,
    SettlementService,
    CancellationService,
    RefundService,
    ProviderEvents,
    CheckoutService,
    AccountService,
    AdminService,
    CurrentAccessGuard,
    LavaWebhookGuard,
    ReconciliationWorker,
    ExpiryWorker,
  ],
})
export class PaymentsModule {}
