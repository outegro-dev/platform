import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  AppError,
  type AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from "@outegro/nest-common";
import { z } from "zod";
import { AccountService } from "../account/account.service.js";
import { subscriptionView } from "../account/views.js";
import { CancellationService } from "../billing/cancellation.js";
import { RefundService } from "../billing/refunds.js";
import type { Actor } from "../common/audit.js";
import { decodeCursor, pageQuery } from "../common/cursor.js";
import { RequestId } from "../common/request-id.js";
import {
  caseKinds,
  caseStates,
  eventStatuses,
  grantSources,
  grantStates,
  orderStatuses,
  paymentStates,
} from "../db/schema.js";
import { subscriptionStates } from "../domain/lifecycle.js";
import { currencies } from "../domain/money.js";
import { AdminService, refundView } from "./admin.service.js";
import { CurrentAccessGuard } from "./current-access.guard.js";

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const reason = z.string().trim().min(3).max(500);

const ordersQuery = z.object({
  ...pageQuery,
  status: z.enum(orderStatuses).optional(),
  userId: uuid.optional(),
  productKey: z.string().max(64).optional(),
  from: instant.optional(),
  to: instant.optional(),
});
const paymentsQuery = z.object({
  ...pageQuery,
  userId: uuid.optional(),
  orderId: uuid.optional(),
  state: z.enum(paymentStates).optional(),
  currency: z.enum(currencies).optional(),
});
const subscriptionsQuery = z.object({
  ...pageQuery,
  userId: uuid.optional(),
  state: z.enum(subscriptionStates).optional(),
  productKey: z.string().max(64).optional(),
});
const eventsQuery = z.object({
  ...pageQuery,
  status: z.enum(eventStatuses).optional(),
  type: z.string().max(100).optional(),
  contractId: z.string().max(128).optional(),
  orderId: uuid.optional(),
});
const issuesQuery = z.object({
  ...pageQuery,
  status: z.enum(["open", "resolved"]).optional(),
  kind: z.string().max(64).optional(),
});
const grantsQuery = z.object({
  ...pageQuery,
  userId: uuid.optional(),
  state: z.enum(grantStates).optional(),
  sourceType: z.enum(grantSources).optional(),
});
const refundsQuery = z.object({
  ...pageQuery,
  state: z.enum(caseStates).optional(),
  kind: z.enum(caseKinds).optional(),
});
const statsQuery = z.object({
  from: instant.optional(),
  to: instant.optional(),
});

const grantBody = z
  .object({
    userId: uuid,
    service: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
    feature: z.string().regex(/^[a-z][a-z0-9.-]{1,80}$/),
    validUntil: instant.nullable().optional(),
    reason,
  })
  .strict();
const reasonBody = z.object({ reason }).strict();
const matchBody = z.object({ paymentId: uuid, reason }).strict();

const cursorOf = (cursor?: string) => (cursor ? decodeCursor(cursor) : null);
const dateOf = (value?: string) => (value ? new Date(value) : undefined);
const idOf = (id: string) => {
  if (!uuid.safeParse(id).success) throw new AppError("NOT_FOUND");
  return id;
};
const actorOf = (user: AuthenticatedUser, requestId: string | null): Actor => ({
  userId: user.userId,
  requestId,
});

/**
 * Billing side of the admin console. Reads need billing.read; commands need
 * their own permission, a fresh token and a reason, and are audited (INV-22).
 */
@Controller("admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly account: AccountService,
    private readonly cancellation: CancellationService,
    private readonly refunds: RefundService,
  ) {}

  @Get("orders")
  @RequirePermissions("billing.read")
  orders(@Query({ schema: ordersQuery }) query: z.infer<typeof ordersQuery>) {
    return this.admin.orders({
      ...query,
      cursor: cursorOf(query.cursor),
      from: dateOf(query.from),
      to: dateOf(query.to),
    });
  }

  @Get("orders/:id")
  @RequirePermissions("billing.read")
  order(@Param("id") id: string) {
    return this.admin.order(idOf(id));
  }

  @Get("payments")
  @RequirePermissions("billing.read")
  payments(
    @Query({ schema: paymentsQuery }) query: z.infer<typeof paymentsQuery>,
  ) {
    return this.admin.payments({ ...query, cursor: cursorOf(query.cursor) });
  }

  @Get("subscriptions")
  @RequirePermissions("billing.read")
  subscriptions(
    @Query({ schema: subscriptionsQuery }) query: z.infer<
      typeof subscriptionsQuery
    >,
  ) {
    return this.admin.subscriptions({
      ...query,
      cursor: cursorOf(query.cursor),
    });
  }

  @Get("provider-events")
  @RequirePermissions("billing.read")
  events(@Query({ schema: eventsQuery }) query: z.infer<typeof eventsQuery>) {
    return this.admin.events({ ...query, cursor: cursorOf(query.cursor) });
  }

  @Get("provider-events/:id")
  @RequirePermissions("billing.read")
  event(@Param("id") id: string) {
    return this.admin.event(idOf(id));
  }

  @Get("issues")
  @RequirePermissions("billing.read")
  issues(@Query({ schema: issuesQuery }) query: z.infer<typeof issuesQuery>) {
    return this.admin.issues({ ...query, cursor: cursorOf(query.cursor) });
  }

  @Get("grants")
  @RequirePermissions("billing.read")
  grants(@Query({ schema: grantsQuery }) query: z.infer<typeof grantsQuery>) {
    return this.admin.grantList({ ...query, cursor: cursorOf(query.cursor) });
  }

  @Get("refunds")
  @RequirePermissions("billing.read")
  refundList(
    @Query({ schema: refundsQuery }) query: z.infer<typeof refundsQuery>,
  ) {
    return this.admin.refundList({ ...query, cursor: cursorOf(query.cursor) });
  }

  @Get("stats")
  @RequirePermissions("billing.read")
  stats(@Query({ schema: statsQuery }) query: z.infer<typeof statsQuery>) {
    return this.admin.stats({ from: dateOf(query.from), to: dateOf(query.to) });
  }

  @Post("grants")
  @RequirePermissions("grants.assign")
  @UseGuards(CurrentAccessGuard)
  grant(
    @CurrentUser() user: AuthenticatedUser,
    @RequestId() requestId: string | null,
    @Body({ schema: grantBody }) body: z.infer<typeof grantBody>,
  ) {
    return this.admin.grant(actorOf(user, requestId), {
      userId: body.userId,
      service: body.service,
      feature: body.feature,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      reason: body.reason,
    });
  }

  @Post("grants/:id/revoke")
  @HttpCode(200)
  @RequirePermissions("grants.assign")
  @UseGuards(CurrentAccessGuard)
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @RequestId() requestId: string | null,
    @Param("id") id: string,
    @Body({ schema: reasonBody }) body: z.infer<typeof reasonBody>,
  ) {
    return this.admin.revoke(actorOf(user, requestId), idOf(id), body.reason);
  }

  /** Stops renewal for a customer; paid time is kept. Not a refund. */
  @Post("subscriptions/:id/cancel")
  @HttpCode(200)
  @RequirePermissions("subscriptions.cancel")
  @UseGuards(CurrentAccessGuard)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @RequestId() requestId: string | null,
    @Param("id") id: string,
    @Body({ schema: reasonBody }) body: z.infer<typeof reasonBody>,
  ) {
    const row = await this.cancellation.cancel(idOf(id), {
      operator: { actor: actorOf(user, requestId), reason: body.reason },
    });
    return subscriptionView(row, await this.account.subscriptionTitle(row.id));
  }

  /** Records that a refund was started in the Lava cabinet; the provider event confirms it. */
  @Post("payments/:id/refund-request")
  @RequirePermissions("refunds.request")
  @UseGuards(CurrentAccessGuard)
  async requestRefund(
    @CurrentUser() user: AuthenticatedUser,
    @RequestId() requestId: string | null,
    @Param("id") id: string,
    @Body({ schema: reasonBody }) body: z.infer<typeof reasonBody>,
  ) {
    return refundView(
      await this.refunds.request(
        actorOf(user, requestId),
        idOf(id),
        body.reason,
      ),
    );
  }

  /** Links an unmatched provider refund to its purchase after checking the evidence. */
  @Post("refunds/:id/match")
  @HttpCode(200)
  @RequirePermissions("refunds.request")
  @UseGuards(CurrentAccessGuard)
  async matchRefund(
    @CurrentUser() user: AuthenticatedUser,
    @RequestId() requestId: string | null,
    @Param("id") id: string,
    @Body({ schema: matchBody }) body: z.infer<typeof matchBody>,
  ) {
    const result = await this.refunds.match(
      actorOf(user, requestId),
      idOf(id),
      body.paymentId,
      body.reason,
    );
    return {
      refund: refundView(result.refund),
      outcome: result.outcome.note ?? null,
    };
  }
}
