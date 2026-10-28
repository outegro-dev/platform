import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  type LlmGenerateRequest,
  llmGenerateRequestSchema,
} from "@outegro/contracts/atelier";
import { AppError, createServiceTokenGuard } from "@outegro/nest-common";
import type { Response } from "express";
import { env } from "../config/env.js";
import { GatewayService } from "./gateway.service.js";

const ServiceToken = createServiceTokenGuard(() => env().LLM_GATEWAY_TOKEN);

/** The gateway API; every route needs the service token (no public port). */
@Controller()
@UseGuards(ServiceToken)
export class GatewayController {
  constructor(private readonly gateway: GatewayService) {}

  /** 200 LlmGenerateResponse, or LlmError with 400, 422, 429, 503, 504. */
  @Post("generate")
  @HttpCode(200)
  generate(
    @Body({ schema: llmGenerateRequestSchema }) body: LlmGenerateRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    // The caller hung up: the provider run is stopped and its slot freed.
    const leaving = new AbortController();
    res.once("close", () => {
      if (!res.writableFinished) leaving.abort();
    });
    return this.gateway.generate(body, leaving.signal);
  }

  @Get("providers")
  providers() {
    return this.gateway.providerList();
  }

  @Delete("providers/:id/pause")
  resume(@Param("id") id: string) {
    const status = this.gateway.resume(id);
    if (!status) throw new AppError("NOT_FOUND");
    return status;
  }

  @Get("profiles")
  profiles() {
    return this.gateway.profileList();
  }
}
