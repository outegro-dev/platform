import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import {
  type BrowserApplyRequest,
  type BrowserApplyResponse,
  browserApplyRequestSchema,
} from "@outegro/contracts/atelier";
import { createServiceTokenGuard, Public } from "@outegro/nest-common";
import { env } from "../config/env.js";
import { ApplyService } from "./apply.service.js";

const ServiceToken = createServiceTokenGuard(() => env().ATELIER_BROWSER_TOKEN);

/**
 * Fills (mode prepare) or fills and submits (mode submit) one ATS form for
 * atelier-backend. Never solves a CAPTCHA and never logs in: those come
 * back as needs_human with the reason.
 */
@Public()
@UseGuards(ServiceToken)
@Controller("apply")
export class ApplyController {
  constructor(private readonly service: ApplyService) {}

  @Post()
  @HttpCode(200)
  apply(
    @Body({ schema: browserApplyRequestSchema }) body: BrowserApplyRequest,
  ): Promise<BrowserApplyResponse> {
    return this.service.apply(body);
  }
}
