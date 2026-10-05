import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  adminAuditQuerySchema,
  adminReadersQuerySchema,
  setBookAccessSchema,
  setBookStatusSchema,
} from "@outegro/contracts/edu";
import {
  type AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from "@outegro/nest-common";
import type { z } from "zod";
import { AdminService } from "./admin.service.js";
import { CurrentAccessGuard } from "./current-access.guard.js";

/**
 * Admin console API (`edu.read` to look, `edu.manage` to act). Commands carry
 * the book's version and a reason, are audited, and need a token issued after
 * the actor's latest role change.
 */
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  @RequirePermissions("edu.read")
  overview() {
    return this.admin.overview();
  }

  @Get("books")
  @RequirePermissions("edu.read")
  books() {
    return this.admin.books();
  }

  @Get("books/:slug")
  @RequirePermissions("edu.read")
  book(@Param("slug") slug: string) {
    return this.admin.book(slug);
  }

  @Post("books/:slug/status")
  @HttpCode(200)
  @RequirePermissions("edu.manage")
  @UseGuards(CurrentAccessGuard)
  setStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("slug") slug: string,
    @Body({ schema: setBookStatusSchema }) body: z.infer<
      typeof setBookStatusSchema
    >,
  ) {
    return this.admin.setStatus(actor, slug, body);
  }

  @Post("books/:slug/access")
  @HttpCode(200)
  @RequirePermissions("edu.manage")
  @UseGuards(CurrentAccessGuard)
  setAccess(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("slug") slug: string,
    @Body({ schema: setBookAccessSchema }) body: z.infer<
      typeof setBookAccessSchema
    >,
  ) {
    return this.admin.setAccess(actor, slug, body);
  }

  @Get("readers")
  @RequirePermissions("edu.read")
  readers(
    @Query({ schema: adminReadersQuerySchema }) query: z.infer<
      typeof adminReadersQuerySchema
    >,
  ) {
    return this.admin.readers(query);
  }

  @Get("readers/:userId")
  @RequirePermissions("edu.read")
  reader(@Param("userId") userId: string) {
    return this.admin.reader(userId);
  }

  @Get("audit")
  @RequirePermissions("edu.read")
  audit(
    @Query({ schema: adminAuditQuerySchema }) query: z.infer<
      typeof adminAuditQuerySchema
    >,
  ) {
    return this.admin.audit(query);
  }
}
