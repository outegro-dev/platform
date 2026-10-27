import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  type AdminCommand,
  adminCommandSchema,
  adminWalletsQuerySchema,
  historyQuerySchema,
  unitQuerySchema,
} from "@outegro/contracts/wallet";
import {
  AppError,
  type AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from "@outegro/nest-common";
import { z } from "zod";
import { RequestId } from "../common/request-id.js";
import { AdminService } from "./admin.service.js";
import { CurrentAccessGuard } from "./current-access.guard.js";

const userIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new AppError("VALIDATION_FAILED", { fieldErrors: { userId: ["uuid"] } }),
});
const auditQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Admin console API (`wallet.read` to look, `wallet.adjust` to act).
 * Commands carry a reason and the form's commandId, are audited in the
 * transaction of the operation, and need a token issued after the actor's
 * latest role change.
 */
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  @RequirePermissions("wallet.read")
  overview(
    @Query({ schema: unitQuerySchema }) query: z.infer<typeof unitQuerySchema>,
  ) {
    return this.admin.overview(query.unit);
  }

  @Get("wallets")
  @RequirePermissions("wallet.read")
  wallets(
    @Query({ schema: adminWalletsQuerySchema }) query: z.infer<
      typeof adminWalletsQuerySchema
    >,
  ) {
    return this.admin.wallets(query);
  }

  @Get("wallets/:userId")
  @RequirePermissions("wallet.read")
  wallet(
    @Param("userId", userIdPipe) userId: string,
    @Query({ schema: historyQuerySchema }) query: z.infer<
      typeof historyQuerySchema
    >,
  ) {
    return this.admin.wallet(userId, query);
  }

  @Post("wallets/:userId/grant")
  @HttpCode(200)
  @RequirePermissions("wallet.adjust")
  @UseGuards(CurrentAccessGuard)
  grant(
    @CurrentUser() actor: AuthenticatedUser,
    @RequestId() requestId: string | null,
    @Param("userId", userIdPipe) userId: string,
    @Body({ schema: adminCommandSchema }) body: AdminCommand,
  ) {
    return this.admin.command(
      "grant",
      { userId: actor.userId, requestId },
      userId,
      body,
    );
  }

  @Post("wallets/:userId/adjust")
  @HttpCode(200)
  @RequirePermissions("wallet.adjust")
  @UseGuards(CurrentAccessGuard)
  adjust(
    @CurrentUser() actor: AuthenticatedUser,
    @RequestId() requestId: string | null,
    @Param("userId", userIdPipe) userId: string,
    @Body({ schema: adminCommandSchema }) body: AdminCommand,
  ) {
    return this.admin.command(
      "adjust",
      { userId: actor.userId, requestId },
      userId,
      body,
    );
  }

  @Get("reconciliation")
  @RequirePermissions("wallet.read")
  reconciliation() {
    return this.admin.reconciliation();
  }

  @Get("audit")
  @RequirePermissions("wallet.read")
  audit(
    @Query({ schema: auditQuerySchema }) query: z.infer<
      typeof auditQuerySchema
    >,
  ) {
    return this.admin.audit(query);
  }
}
