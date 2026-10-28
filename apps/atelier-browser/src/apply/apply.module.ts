import { Module } from "@nestjs/common";
import { BrowserPool } from "../browser/browser-pool.js";
import { ApplyController } from "./apply.controller.js";
import {
  APPLY_OVERRIDES,
  type ApplyOverrides,
  ApplyService,
} from "./apply.service.js";

@Module({
  controllers: [ApplyController],
  providers: [
    BrowserPool,
    ApplyService,
    // Production: real ATS hosts only; tests override it for local fixtures.
    { provide: APPLY_OVERRIDES, useValue: {} satisfies ApplyOverrides },
  ],
})
export class ApplyModule {}
