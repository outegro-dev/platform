import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { createServiceTokenGuard, Public } from "@outegro/nest-common";
import { z } from "zod";
import { env } from "../config/env.js";
import { UsersService } from "./users.service.js";

const ServiceToken = createServiceTokenGuard(() => env().INTERNAL_API_TOKEN);
const lookupSchema = z.object({ userId: z.uuid() });

/**
 * For services that project Identity data and missed the events (a service
 * deployed after its users signed up): the current contact and status of one
 * user, over the shared service token only.
 */
@Public()
@UseGuards(ServiceToken)
@Controller("internal/users")
export class InternalUsersController {
  constructor(private readonly users: UsersService) {}

  @Post("lookup")
  @HttpCode(200)
  async lookup(
    @Body({ schema: lookupSchema }) body: z.infer<typeof lookupSchema>,
  ) {
    const user = await this.users.get(body.userId);
    return {
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      locale: user.locale,
      status: user.status,
      accessVersion: user.accessVersion,
      /**
       * The aggregateVersion user events carry: a projection stores it with
       * this data, so an older event arriving later changes nothing.
       */
      version: user.version,
    };
  }
}
