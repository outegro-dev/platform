import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { heldBySafeMode } from "@outegro/nest-common";
import { ZodError } from "zod";
import { PoisonMessageError, TaskBus } from "../messaging/task-bus.js";
import { OrchestratorService } from "./orchestrator.service.js";

/** atelier.results → the orchestrator (api role). */
@Injectable()
export class ResultsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger("Results");

  constructor(
    private readonly bus: TaskBus,
    private readonly orchestrator: OrchestratorService,
  ) {}

  async onApplicationBootstrap() {
    if (heldBySafeMode("atelier-results")) return;
    await this.bus.consumeResults(
      async (raw) => {
        try {
          const outcome = await this.orchestrator.handleResult(raw);
          if (outcome !== "applied")
            this.logger.debug?.({ outcome }, "Result not applied");
        } catch (error) {
          if (error instanceof ZodError)
            throw new PoisonMessageError(`invalid result: ${error.message}`);
          throw error;
        }
      },
      { prefetch: 8 },
    );
  }
}
