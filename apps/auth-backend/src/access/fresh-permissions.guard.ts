import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@outegro/contracts";
import { AppError, type AuthenticatedUser } from "@outegro/nest-common";
import type { Request } from "express";
import { RolesService } from "./roles.service.js";

const FRESH = "identity:freshPermissions";

/** Admin commands: permissions re-read from the database, not from the token. */
export const RequireFreshPermissions = (...permissions: Permission[]) =>
  SetMetadata(FRESH, permissions);

@Injectable()
export class FreshPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly roles: RolesService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      FRESH,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user) throw new AppError("UNAUTHENTICATED");
    const granted = await this.roles.freshPermissions(user.userId);
    if (!required.every((permission) => granted.has(permission)))
      throw new AppError("FORBIDDEN");
    return true;
  }
}
