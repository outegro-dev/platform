import { Global, Module } from "@nestjs/common";
import { ApiModule } from "./api/api.module.js";
import { type StorageConfig, storageConfig } from "./config/config.js";
import { env } from "./config/env.js";
import { TaskBus } from "./messaging/task-bus.js";
import { TaskRelay } from "./messaging/task-relay.js";
import { OrchestratorService } from "./orchestrator/orchestrator.service.js";
import { ResultsConsumer } from "./orchestrator/results.consumer.js";
import { SchedulerService } from "./orchestrator/scheduler.service.js";
import { createStorage, STORAGE } from "./storage/storage.js";

/** RabbitMQ (tasks and results) and file storage: both roles. */
@Global()
@Module({
  providers: [
    TaskBus,
    {
      provide: STORAGE,
      inject: [storageConfig.KEY],
      useFactory: (config: StorageConfig) =>
        createStorage(config, env().DATABASE_URL),
    },
  ],
  exports: [TaskBus, STORAGE],
})
export class InfraModule {}

/** The orchestrator: jobs, the task outbox, results and timers (api role). */
@Global()
@Module({
  providers: [
    TaskRelay,
    OrchestratorService,
    ResultsConsumer,
    SchedulerService,
  ],
  exports: [OrchestratorService, TaskRelay, SchedulerService],
})
export class OrchestratorModule {}

export { ApiModule };
