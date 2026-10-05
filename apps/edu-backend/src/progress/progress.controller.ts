import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import {
  type AttemptResult,
  type CardState,
  cardResultSchema,
  type ExerciseAttempt,
  type ExplainKind,
  exerciseAttemptSchema,
  type ProgressResponse,
  positionSchema,
} from "@outegro/contracts/edu";
import { type AuthenticatedUser, CurrentUser } from "@outegro/nest-common";
import type { z } from "zod";
import { IdempotencyKey } from "../common/idempotency.js";
import { ViewerService } from "../readers/viewer.service.js";
import { ProgressService } from "./progress.service.js";

/** The signed-in reader's own progress; ownership comes from the token. */
@Controller("me/books")
export class ProgressController {
  constructor(
    private readonly progress: ProgressService,
    private readonly viewers: ViewerService,
  ) {}

  @Get(":slug/progress")
  async mine(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slug") slug: string,
  ): Promise<ProgressResponse> {
    return this.progress.progress(await this.viewers.of(user), slug);
  }

  /**
   * The reader's answer; the server judges it against the book. With an
   * Idempotency-Key a retried request replays the stored outcome.
   */
  @Post(":slug/exercises/:exerciseId/attempts")
  @HttpCode(200)
  async attempt(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slug") slug: string,
    @Param("exerciseId") exerciseId: string,
    @Body({ schema: exerciseAttemptSchema }) body: ExerciseAttempt,
    @IdempotencyKey() key: string | null,
  ): Promise<AttemptResult> {
    return this.progress.attempt(
      await this.viewers.of(user),
      slug,
      exerciseId,
      body,
      key,
    );
  }

  @Put(":slug/cards/:cardId")
  async card(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slug") slug: string,
    @Param("cardId") cardId: string,
    @Body({ schema: cardResultSchema }) body: z.infer<typeof cardResultSchema>,
    @IdempotencyKey() key: string | null,
  ): Promise<{ state: CardState }> {
    return this.progress.markCard(
      await this.viewers.of(user),
      slug,
      cardId,
      body.state,
      key,
    );
  }

  @Patch(":slug/progress")
  async move(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slug") slug: string,
    @Body({ schema: positionSchema }) body: z.infer<typeof positionSchema>,
  ): Promise<{ lastChapter: number | null; explainView: ExplainKind | null }> {
    return this.progress.move(await this.viewers.of(user), slug, body);
  }
}
