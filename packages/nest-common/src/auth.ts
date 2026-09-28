import {
  type CanActivate,
  createParamDecorator,
  type DynamicModule,
  type ExecutionContext,
  Inject,
  Injectable,
  Module,
  SetMetadata,
} from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { type Permission, permissionsOf } from "@outegro/contracts";
import type { Request } from "express";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";
import { AppError } from "./errors.js";

export type AuthenticatedUser = {
  userId: string;
  sessionId: string;
  roles: string[];
  accessVersion: number;
};

export type AuthOptions = {
  issuer: string;
  audience: string;
  /** Remote JWKS URL (every service) or a local key getter (Identity itself, tests). */
  keys: URL | JWTVerifyGetKey;
  /**
   * Optional live check (Identity: refresh family still exists), so a revoked
   * session stops working at once instead of when its access token expires.
   */
  isSessionActive?: (user: AuthenticatedUser) => Promise<boolean>;
};

const AUTH_OPTIONS = Symbol("AUTH_OPTIONS");
const IS_PUBLIC = "outegro:isPublic";
const PERMISSIONS = "outegro:permissions";

const claimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  roles: z.array(z.string()).default([]),
  av: z.number().int().nonnegative().default(0),
});

/** Verifies ES256 access tokens issued by Identity. */
@Injectable()
export class AccessTokenVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(@Inject(AUTH_OPTIONS) private readonly options: AuthOptions) {
    this.keys =
      options.keys instanceof URL
        ? createRemoteJWKSet(options.keys, {
            cooldownDuration: 30_000,
            cacheMaxAge: 600_000,
          })
        : options.keys;
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ["ES256"],
        clockTolerance: 5,
      });
      const claims = claimsSchema.parse(payload);
      const user = {
        userId: claims.sub,
        sessionId: claims.sid,
        roles: claims.roles,
        accessVersion: claims.av,
      };
      if (
        this.options.isSessionActive &&
        !(await this.options.isSessionActive(user))
      ) {
        throw new Error("session revoked");
      }
      return user;
    } catch (error) {
      throw new AppError("UNAUTHENTICATED", { cause: error });
    }
  }
}

/** Route or controller without authentication (health, login, webhooks). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Deny unless the caller's platform roles grant every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS, permissions);

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user) throw new AppError("UNAUTHENTICATED");
    return user;
  },
);

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ")
      ? header.slice(7).trim()
      : undefined;
    if (!token) throw new AppError("UNAUTHENTICATED");
    request.user = await this.verifier.verify(token);
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user) throw new AppError("UNAUTHENTICATED");
    const granted = permissionsOf(user.roles);
    if (!required.every((permission) => granted.has(permission))) {
      throw new AppError("FORBIDDEN");
    }
    return true;
  }
}

/**
 * Registers both guards globally: every route requires a valid access token
 * unless marked @Public(), then @RequirePermissions() is enforced.
 */
@Module({})
export class AuthModule {
  static forRootAsync(options: {
    imports?: DynamicModule["imports"];
    inject?: (string | symbol | (abstract new (...args: never[]) => unknown))[];
    useFactory: (...args: never[]) => AuthOptions;
  }): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: AUTH_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
        AccessTokenVerifier,
        { provide: APP_GUARD, useClass: AccessTokenGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
      exports: [AccessTokenVerifier],
    };
  }
}
