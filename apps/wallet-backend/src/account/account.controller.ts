import { Controller, Get, Query } from "@nestjs/common";
import { historyQuerySchema, unitQuerySchema } from "@outegro/contracts/wallet";
import { type AuthenticatedUser, CurrentUser } from "@outegro/nest-common";
import type { z } from "zod";
import { AccountService } from "./account.service.js";

/** The signed-in player's own wallet: balance and history, nothing else. */
@Controller("me/wallet")
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  wallet(
    @CurrentUser() user: AuthenticatedUser,
    @Query({ schema: unitQuerySchema }) query: z.infer<typeof unitQuerySchema>,
  ) {
    return this.account.wallet(user.userId, query.unit);
  }

  @Get("history")
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query({ schema: historyQuerySchema }) query: z.infer<
      typeof historyQuerySchema
    >,
  ) {
    return this.account.history(user.userId, query);
  }
}
