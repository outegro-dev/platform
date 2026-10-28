import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from "@nestjs/common";
import {
  type AddVacancyRequest,
  type ApplicationCard,
  type ApplicationDetail,
  addVacancyRequestSchema,
  type Board,
  type Inbox,
  type MoveStageRequest,
  moveStageRequestSchema,
  type PipelineOverview,
} from "@outegro/contracts/atelier";
import {
  AppError,
  type AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from "@outegro/nest-common";
import type { Response } from "express";
import { z } from "zod";
import { contentDisposition } from "../cv-links/naming.js";
import { BoardService } from "./board.service.js";
import { OwnerService } from "./owner.service.js";

export const sendRequestSchema = z
  .object({ mode: z.enum(["prepare", "submit"]).default("submit") })
  .default({ mode: "submit" });
export const retryRequestSchema = z
  .object({ fromStep: z.string().min(1).max(40).optional() })
  .default({});

/**
 * The owner's API for atelier-web. Every route needs a platform access
 * token whose roles grant `atelier.use` (the owner role has it).
 */
@RequirePermissions("atelier.use")
@Controller()
export class AtelierController {
  constructor(
    private readonly board: BoardService,
    private readonly owners: OwnerService,
  ) {}

  private me(user: AuthenticatedUser) {
    return this.owners.userIdOf(user.userId);
  }

  @Get("board")
  async getBoard(@CurrentUser() user: AuthenticatedUser): Promise<Board> {
    return this.board.board(await this.me(user));
  }

  @Get("applications/:id")
  async getApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ApplicationDetail> {
    return this.board.detail(await this.me(user), id);
  }

  @Get("applications/:id/cv.pdf")
  async downloadCv(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    const file = await this.board.cvFile(await this.me(user), id);
    response
      .status(200)
      .set({
        "content-type": "application/pdf",
        "content-disposition": contentDisposition("attachment", file.fileName),
        "cache-control": "private, no-store",
      })
      .send(file.body);
  }

  @Post("vacancies")
  @HttpCode(202)
  async addVacancy(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: addVacancyRequestSchema }) body: AddVacancyRequest,
  ) {
    return this.board.addVacancy(await this.me(user), body);
  }

  @Post("applications/:id/stage")
  @HttpCode(200)
  async moveStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: moveStageRequestSchema }) body: MoveStageRequest,
  ): Promise<ApplicationCard> {
    if (body.stage !== "archived" && body.archiveReason)
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { archiveReason: ["only for archived"] },
      });
    return this.board.moveStage(await this.me(user), id, body);
  }

  @Post("applications/:id/send")
  @HttpCode(202)
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: sendRequestSchema }) body: z.infer<
      typeof sendRequestSchema
    >,
  ) {
    return this.board.send(await this.me(user), id, body.mode);
  }

  @Post("applications/:id/retry")
  @HttpCode(202)
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: retryRequestSchema }) body: z.infer<
      typeof retryRequestSchema
    >,
  ) {
    return this.board.retry(await this.me(user), id, body.fromStep);
  }

  @Get("inbox")
  async inbox(@CurrentUser() user: AuthenticatedUser): Promise<Inbox> {
    return this.board.inbox(await this.me(user));
  }

  @Post("inbox/:applicationId/skip")
  @HttpCode(200)
  async skip(
    @CurrentUser() user: AuthenticatedUser,
    @Param("applicationId", ParseUUIDPipe) applicationId: string,
  ) {
    return this.board.skip(await this.me(user), applicationId);
  }

  @Get("pipeline")
  async pipeline(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PipelineOverview> {
    return this.board.pipeline(await this.me(user));
  }

  @Delete("providers/:id/pause")
  async releaseProvider(@Param("id") id: string) {
    if (!/^[a-z0-9._-]{1,80}$/i.test(id)) throw new AppError("NOT_FOUND");
    return this.board.releaseProvider(id);
  }

  @Get("profile")
  async profile(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.owners.profileOf(user.userId);
    if (!profile)
      throw new AppError("NOT_FOUND", { message: "no profile imported" });
    return {
      name: profile.person.name,
      headline: profile.headline,
      factsMode: profile.factsMode,
      maxPages: profile.maxPages,
      form: profile.form,
      cases: profile.bank.cases.map((item) => ({
        id: item.id,
        companyId: item.companyId,
        company:
          profile.companies.find((company) => company.id === item.companyId)
            ?.name ?? item.companyId,
        title: item.title,
        technologies: item.technologies,
        active: item.active,
      })),
    };
  }
}
