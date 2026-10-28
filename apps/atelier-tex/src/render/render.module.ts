import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "../health/health.controller.js";
import { RenderController } from "./render.controller.js";
import { RenderService } from "./render.service.js";
import { SpawnToolRunner, TOOL_RUNNER } from "./tools.js";

@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: "json" })],
  controllers: [RenderController, HealthController],
  providers: [
    RenderService,
    { provide: TOOL_RUNNER, useClass: SpawnToolRunner },
  ],
})
export class RenderModule {}
