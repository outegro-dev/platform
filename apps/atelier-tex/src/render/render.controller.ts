import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  type TexRenderRequest,
  type TexRenderResponse,
  texRenderRequestSchema,
} from "@outegro/contracts/atelier";
import { createServiceTokenGuard, Public } from "@outegro/nest-common";
import { env } from "../config/env.js";
import { RenderService } from "./render.service.js";

const ServiceToken = createServiceTokenGuard(() => env().ATELIER_TEX_TOKEN);

/**
 * POST /v1/render for atelier-backend's fit step: one CV, compiled and
 * measured. A LaTeX error answers 422 with the log tail in
 * `fieldErrors.log`; all slots busy and the queue full, 429 (retryable).
 */
@Public()
@UseGuards(ServiceToken)
@Controller("render")
export class RenderController {
  constructor(@Inject(RenderService) private readonly renders: RenderService) {}

  @Post()
  @HttpCode(200)
  render(
    @Body({ schema: texRenderRequestSchema }) body: TexRenderRequest,
  ): Promise<TexRenderResponse> {
    return this.renders.render(body);
  }
}
