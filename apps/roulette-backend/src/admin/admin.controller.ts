import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  adminPlayersQuerySchema,
  tableCommandSchema,
  voidCommandSchema,
} from "@outegro/contracts/roulette";
import {
  AppError,
  type AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from "@outegro/nest-common";
import type { Request } from "express";
import { z } from "zod";
import { CurrentAccessGuard } from "../identity/identity.js";
import { VoidService } from "../rounds/void.service.js";
import { TableSettingsService } from "../table/table.settings.js";
import { AdminService } from "./admin.service.js";

const pageSchema = z.object({
  cursor: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const roundParam = z.coerce.number().int().positive();

function roundOf(raw: string): number {
  const parsed = roundParam.safeParse(raw);
  if (!parsed.success)
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: { round: ["a round number from 1"] },
    });
  return parsed.data;
}

const requestIdOf = (request: Request & { id?: unknown }) =>
  request.id === undefined ? undefined : String(request.id);

/**
 * Admin console API (ADR-012): `roulette.read` to look, `roulette.manage`
 * for the table, `roulette.void` (owner) to cancel a round. Commands carry
 * a reason (and the table's version), may be previewed, are audited, and
 * need a token issued after the actor's latest role change.
 */
@Controller("admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly table: TableSettingsService,
    private readonly voids: VoidService,
  ) {}

  @Get("live")
  @RequirePermissions("roulette.read")
  live() {
    return this.admin.live();
  }

  @Get("rounds")
  @RequirePermissions("roulette.read")
  rounds(@Query({ schema: pageSchema }) query: z.infer<typeof pageSchema>) {
    return this.admin.rounds(query.cursor, query.limit);
  }

  @Get("rounds/:round")
  @RequirePermissions("roulette.read")
  round(@Param("round") raw: string) {
    return this.admin.roundDetail(roundOf(raw));
  }

  @Post("rounds/:round/void")
  @HttpCode(200)
  @RequirePermissions("roulette.void")
  @UseGuards(CurrentAccessGuard)
  void(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("round") raw: string,
    @Body({ schema: voidCommandSchema }) body: z.infer<
      typeof voidCommandSchema
    >,
    @Req() request: Request,
  ) {
    return this.voids.void(actor, roundOf(raw), body, requestIdOf(request));
  }

  @Get("players")
  @RequirePermissions("roulette.read")
  players(
    @Query({ schema: adminPlayersQuerySchema }) query: z.infer<
      typeof adminPlayersQuerySchema
    >,
  ) {
    return this.admin.players(query);
  }

  @Get("players/:userId")
  @RequirePermissions("roulette.read")
  player(@Param("userId") userId: string) {
    if (!z.uuid().safeParse(userId).success) throw new AppError("NOT_FOUND");
    return this.admin.playerDetail(userId);
  }

  @Get("table")
  @RequirePermissions("roulette.read")
  tableSettings() {
    return this.table.reload();
  }

  @Post("table")
  @HttpCode(200)
  @RequirePermissions("roulette.manage")
  @UseGuards(CurrentAccessGuard)
  changeTable(
    @CurrentUser() actor: AuthenticatedUser,
    @Body({ schema: tableCommandSchema }) body: z.infer<
      typeof tableCommandSchema
    >,
    @Req() request: Request,
  ) {
    return this.table.command(actor, body, requestIdOf(request));
  }

  @Get("services")
  @RequirePermissions("roulette.read")
  services() {
    return this.admin.servicesHealth();
  }

  @Get("audit")
  @RequirePermissions("roulette.read")
  audit(@Query({ schema: pageSchema }) query: z.infer<typeof pageSchema>) {
    return this.admin.audit(query.cursor);
  }
}
