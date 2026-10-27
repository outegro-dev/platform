import { Module } from "@nestjs/common";
import { AccountController } from "./account/account.controller.js";
import { AccountService } from "./account/account.service.js";
import { AdminController } from "./admin/admin.controller.js";
import { AdminService } from "./admin/admin.service.js";
import { CurrentAccessGuard } from "./admin/current-access.guard.js";
import { WalletMetrics } from "./common/metrics.js";
import { IdentityConsumer } from "./events/identity.consumer.js";
import { InternalController } from "./internal/internal.controller.js";
import { WalletLedger } from "./ledger/ledger.js";
import { ReconciliationService } from "./reconciliation/reconciliation.service.js";
import { ReconciliationWorker } from "./reconciliation/reconciliation.worker.js";

@Module({
  controllers: [InternalController, AccountController, AdminController],
  providers: [
    WalletMetrics,
    WalletLedger,
    AccountService,
    AdminService,
    CurrentAccessGuard,
    IdentityConsumer,
    ReconciliationService,
    ReconciliationWorker,
  ],
})
export class WalletModule {}
