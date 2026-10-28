import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { FairInfo, FairReveal } from "@outegro/contracts/roulette";
import {
  AppError,
  createServiceTokenGuard,
  Public,
} from "@outegro/nest-common";
import { z } from "zod";
import { env } from "../config/env.js";
import { RevealService } from "./reveal.service.js";

const ServiceToken = createServiceTokenGuard(() => env().INTERNAL_API_TOKEN);
const roundParam = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

/**
 * The only API of fair-roll, inside the cluster over the shared service
 * token: the public commit and the reveal of the next round.
 */
@Public()
@UseGuards(ServiceToken)
@Controller("internal")
export class InternalController {
  constructor(private readonly reveals: RevealService) {}

  @Get("chain")
  chain(): Promise<FairInfo> {
    return this.reveals.info();
  }

  @Post("rounds/:round/reveal")
  @HttpCode(200)
  reveal(@Param("round") raw: string): Promise<FairReveal> {
    const round = roundParam.safeParse(raw);
    if (!round.success)
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { round: ["a round number from 1"] },
      });
    return this.reveals.reveal(round.data);
  }
}
