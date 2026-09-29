import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import {
  AppError,
  type AuthenticatedUser,
  CurrentUser,
} from "@outegro/nest-common";
import { z } from "zod";
import { CancellationService } from "../billing/cancellation.js";
import { decodeCursor, pageQuery } from "../common/cursor.js";
import { AccountService } from "./account.service.js";
import { subscriptionView } from "./views.js";

const listSchema = z.object(pageQuery);
const uuid = z.uuid();

/** The signed-in user's purchases and subscriptions. */
@Controller("me")
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly cancellation: CancellationService,
  ) {}

  @Get("orders")
  orders(
    @CurrentUser() user: AuthenticatedUser,
    @Query({ schema: listSchema }) query: z.infer<typeof listSchema>,
  ) {
    return this.account.orders(
      user.userId,
      query.cursor ? decodeCursor(query.cursor) : null,
      query.limit,
    );
  }

  /** The return page polls this; the provider's redirect proves nothing. */
  @Get("orders/:id")
  order(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    if (!uuid.safeParse(id).success) throw new AppError("NOT_FOUND");
    return this.account.order(user.userId, id);
  }

  @Get("subscriptions")
  subscriptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query({ schema: listSchema }) query: z.infer<typeof listSchema>,
  ) {
    return this.account.subscriptions(
      user.userId,
      query.cursor ? decodeCursor(query.cursor) : null,
      query.limit,
    );
  }

  /** Turns renewal off; paid access stays until the period ends. Not a refund. */
  @Post("subscriptions/:id/cancel")
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    if (!uuid.safeParse(id).success) throw new AppError("NOT_FOUND");
    const row = await this.cancellation.cancel(id, { ownerId: user.userId });
    return subscriptionView(row, await this.account.subscriptionTitle(row.id));
  }
}
