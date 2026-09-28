import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { Public } from "@outegro/nest-common";
import { z } from "zod";
import { Client, type ClientContext } from "../common/client-context.js";
import { SessionsService } from "./sessions.service.js";

const refreshSchema = z.object({ refreshToken: z.string().min(40).max(200) });

@Public()
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post("refresh")
  @HttpCode(200)
  refresh(
    @Body({ schema: refreshSchema }) body: z.infer<typeof refreshSchema>,
    @Client() client: ClientContext,
  ) {
    return this.sessions.rotate(body.refreshToken, client);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Body({ schema: refreshSchema }) body: z.infer<typeof refreshSchema>,
  ) {
    await this.sessions.logout(body.refreshToken);
  }
}
