import { Controller, Get, Param, Req } from "@nestjs/common";
import type {
  BookResponse,
  ChapterResponse,
  DeckResponse,
  LibraryResponse,
  PrefaceResponse,
} from "@outegro/contracts/edu";
import {
  AccessTokenVerifier,
  AppError,
  type AuthenticatedUser,
  Public,
} from "@outegro/nest-common";
import type { Request } from "express";
import type { Viewer } from "../domain/access.js";
import { ViewerService } from "../readers/viewer.service.js";
import { LibraryService } from "./library.service.js";

/** Chapter numbers in URLs: positive integers written plainly. */
const chapterNumber = /^[1-9]\d{0,5}$/;

/**
 * Public reader API; with a valid token the caller's grants, staff role and
 * progress apply. A missing or malformed chapter number is not there (404).
 */
@Public()
@Controller("books")
export class BooksController {
  constructor(
    private readonly library: LibraryService,
    private readonly viewers: ViewerService,
    private readonly verifier: AccessTokenVerifier,
  ) {}

  @Get()
  async list(@Req() request: Request): Promise<LibraryResponse> {
    return this.library.library(await this.viewer(request));
  }

  @Get(":slug")
  async book(
    @Req() request: Request,
    @Param("slug") slug: string,
  ): Promise<BookResponse> {
    return this.library.book(await this.viewer(request), slug);
  }

  @Get(":slug/chapters/:n")
  async chapter(
    @Req() request: Request,
    @Param("slug") slug: string,
    @Param("n") n: string,
  ): Promise<ChapterResponse> {
    const viewer = await this.viewer(request);
    if (!chapterNumber.test(n)) throw new AppError("NOT_FOUND");
    return this.library.chapter(viewer, slug, Number(n));
  }

  @Get(":slug/preface")
  async preface(
    @Req() request: Request,
    @Param("slug") slug: string,
  ): Promise<PrefaceResponse> {
    return this.library.preface(await this.viewer(request), slug);
  }

  @Get(":slug/cards")
  async deck(
    @Req() request: Request,
    @Param("slug") slug: string,
  ): Promise<DeckResponse> {
    return this.library.deck(await this.viewer(request), slug);
  }

  /** Optional auth: no header is signed out, a bad token is 401 (the BFF refreshes). */
  private async viewer(request: Request): Promise<Viewer> {
    const header = request.headers.authorization;
    let user: AuthenticatedUser | null = null;
    if (header) {
      if (!header.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED");
      user = await this.verifier.verify(header.slice(7).trim());
    }
    return this.viewers.of(user);
  }
}
