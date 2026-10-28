import { Module } from "@nestjs/common";
import { type ServicesConfig, servicesConfig } from "../config/config.js";
import { STORAGE, type Storage } from "../storage/storage.js";
import {
  defaultPorts,
  STEP_HANDLERS,
  STEP_PORTS,
  WorkerService,
} from "./worker.service.js";

/** Consumes the task queues and runs the step handlers (worker role). */
@Module({
  providers: [
    {
      provide: STEP_HANDLERS,
      // Loaded only when a worker runs: the engine and sources come with it.
      useFactory: async () =>
        (await import("../steps/registry.js")).defaultHandlers(),
    },
    {
      provide: STEP_PORTS,
      inject: [servicesConfig.KEY, STORAGE],
      useFactory: (services: ServicesConfig, storage: Storage) =>
        defaultPorts(services, storage),
    },
    WorkerService,
  ],
})
export class WorkerModule {}
