import { Body, Controller, Get, Param, Post, Res } from "@nestjs/common";
import {
  type AssistExplain,
  type AssistSqlHint,
  type AssistStatus,
  type AssistUnderstanding,
  assistExplainSchema,
  assistSqlHintSchema,
  assistUnderstandingSchema,
} from "@outegro/contracts/edu";
import { type AuthenticatedUser, CurrentUser } from "@outegro/nest-common";
import type { Response } from "express";
import { ViewerService } from "../readers/viewer.service.js";
import { AssistService } from "./assist.service.js";
import { hangUpSignal, SseResponder } from "./sse.js";

/**
 * The signed-in reader's assistant. Refusals are JSON errors before the
 * stream; an answer is `text/event-stream` (`data:` lines of
 * assistEventSchema), and a reader who goes away stops the model.
 */
@Controller("me")
export class AssistController {
  constructor(
    private readonly assist: AssistService,
    private readonly viewers: ViewerService,
    private readonly sse: SseResponder,
  ) {}

  @Get("assist")
  async status(@CurrentUser() user: AuthenticatedUser): Promise<AssistStatus> {
    return this.assist.status(await this.viewers.of(user));
  }

  @Post("books/:slug/assist/explain")
  async explain(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slug") slug: string,
    @Body({ schema: assistExplainSchema }) body: AssistExplain,
    @Res() res: Response,
  ): Promise<void> {
    const hangUp = hangUpSignal(res);
    const viewer = await this.viewers.of(user);
    const answer = await this.assist.explain(viewer, slug, body, hangUp);
    await this.sse.respond(res, answer, hangUp);
  }

  @Post("books/:slug/assist/understanding")
  async understanding(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slug") slug: string,
    @Body({ schema: assistUnderstandingSchema }) body: AssistUnderstanding,
    @Res() res: Response,
  ): Promise<void> {
    const hangUp = hangUpSignal(res);
    const viewer = await this.viewers.of(user);
    const answer = await this.assist.understanding(viewer, slug, body, hangUp);
    await this.sse.respond(res, answer, hangUp);
  }

  @Post("books/:slug/assist/sql-hint")
  async sqlHint(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slug") slug: string,
    @Body({ schema: assistSqlHintSchema }) body: AssistSqlHint,
    @Res() res: Response,
  ): Promise<void> {
    const hangUp = hangUpSignal(res);
    const viewer = await this.viewers.of(user);
    const answer = await this.assist.sqlHint(viewer, slug, body, hangUp);
    await this.sse.respond(res, answer, hangUp);
  }
}
