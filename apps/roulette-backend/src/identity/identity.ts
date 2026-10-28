import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  AppError,
  type AuthenticatedUser,
  callInternal,
} from "@outegro/nest-common";
import type { Request } from "express";
import { z } from "zod";
import { IDENTITY } from "../common/tokens.js";

const lookupSchema = z.object({
  status: z.enum(["active", "suspended", "deleted"]),
  accessVersion: z.number().int().nonnegative(),
});
export type IdentityUser = z.infer<typeof lookupSchema>;

/** What roulette asks Identity about a user (its internal lookup). */
export interface IdentityPort {
  lookup(userId: string): Promise<IdentityUser>;
}

/** Identity's `POST /v1/internal/users/lookup` over the shared service token. */
export class HttpIdentity implements IdentityPort {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async lookup(userId: string): Promise<IdentityUser> {
    try {
      return lookupSchema.parse(
        await callInternal(`${this.baseUrl}/v1/internal/users/lookup`, {
          token: this.token,
          body: { userId },
          timeoutMs: 3000,
        }),
      );
    } catch (error) {
      throw new AppError("DEPENDENCY_UNAVAILABLE", { cause: error });
    }
  }
}

/**
 * Admin commands (table changes, voiding a round): the token's roles count
 * only if it was issued after the actor's latest role or status change, as
 * Identity says right now. A stale token gets 401 and is refreshed; a
 * suspended actor gets 403.
 */
@Injectable()
export class CurrentAccessGuard implements CanActivate {
  constructor(@Inject(IDENTITY) private readonly identity: IdentityPort) {}

  async canActivate(context: ExecutionContext) {
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user) throw new AppError("UNAUTHENTICATED");
    const current = await this.identity.lookup(user.userId);
    if (current.status !== "active") throw new AppError("FORBIDDEN");
    if (current.accessVersion > user.accessVersion)
      throw new AppError("UNAUTHENTICATED", { message: "stale access token" });
    return true;
  }
}
