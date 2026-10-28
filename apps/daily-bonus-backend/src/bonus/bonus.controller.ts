import { Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import {
  type DailyClaim,
  type DailyStatus,
  deviceIdHeader,
  deviceIdSchema,
} from "@outegro/contracts/daily-bonus";
import { type AuthenticatedUser, CurrentUser } from "@outegro/nest-common";
import type { Request } from "express";
import { BonusService } from "./bonus.service.js";

/**
 * The player's bonus, called by the roulette-web BFF with the user's token;
 * the BFF forwards the client address and its device cookie.
 */
@Controller("daily")
export class BonusController {
  constructor(private readonly bonus: BonusService) {}

  @Get()
  status(@CurrentUser() user: AuthenticatedUser): Promise<DailyStatus> {
    return this.bonus.status(user.userId);
  }

  @Post("claim")
  @HttpCode(200)
  claim(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<DailyClaim> {
    const device = deviceIdSchema.safeParse(request.get(deviceIdHeader));
    return this.bonus.claim(user.userId, {
      // One trusted proxy hop: Express resolves the client address.
      ip: request.ip,
      device: device.success ? device.data : undefined,
    });
  }
}
