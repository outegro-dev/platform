import { Module } from "@nestjs/common";
import { AdminController } from "./access/admin.controller.js";
import { FreshPermissionsGuard } from "./access/fresh-permissions.guard.js";
import { RolesService } from "./access/roles.service.js";
import { GrantsService } from "./grants/grants.service.js";
import { KeysModule } from "./keys/keys.module.js";
import { CODE_DELIVERY, HttpCodeDelivery } from "./login/code-delivery.js";
import { LoginController } from "./login/login.controller.js";
import { LoginService } from "./login/login.service.js";
import { OAuthController } from "./oauth/oauth.controller.js";
import { OAuthService } from "./oauth/oauth.service.js";
import { SessionStoreModule } from "./sessions/session-store.module.js";
import { SessionsController } from "./sessions/sessions.controller.js";
import { SessionsService } from "./sessions/sessions.service.js";
import { MeController } from "./users/me.controller.js";
import { UsersService } from "./users/users.service.js";

@Module({
  imports: [KeysModule, SessionStoreModule],
  controllers: [
    LoginController,
    SessionsController,
    MeController,
    AdminController,
    OAuthController,
  ],
  providers: [
    RolesService,
    UsersService,
    SessionsService,
    LoginService,
    GrantsService,
    OAuthService,
    FreshPermissionsGuard,
    { provide: CODE_DELIVERY, useClass: HttpCodeDelivery },
  ],
  exports: [RolesService, UsersService],
})
export class IdentityModule {}
