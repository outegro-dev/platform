import type { AtelierTaskType } from "@outegro/contracts/atelier";
import { channelStep, sendStep, textsStep } from "./apply.steps.js";
import {
  analyzeStep,
  extractStep,
  fetchStep,
  structureStep,
} from "./catalog.steps.js";
import { fitStep } from "./fit.step.js";
import {
  adaptStep,
  atsCheckStep,
  composeStep,
  fallbackStep,
  matchStep,
  repairStep,
  reviewStep,
  selectStep,
  storeStep,
} from "./resume.steps.js";
import type { StepHandler } from "./step-handler.js";

/** Every step handler a worker can run, by task type. */
export function defaultHandlers(): Map<AtelierTaskType, StepHandler<never>> {
  const handlers = [
    fetchStep,
    extractStep,
    structureStep,
    analyzeStep,
    matchStep,
    selectStep,
    composeStep,
    adaptStep,
    reviewStep,
    repairStep,
    fallbackStep,
    fitStep,
    atsCheckStep,
    storeStep,
    textsStep,
    channelStep,
    sendStep,
  ] as StepHandler<never>[];
  return new Map(handlers.map((handler) => [handler.type, handler]));
}
