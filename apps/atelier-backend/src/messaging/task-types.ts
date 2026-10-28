import type { AtelierTaskType } from "@outegro/contracts/atelier";

/**
 * Task types that run in a worker and so have a queue. `dedupe` and the
 * tick steps run inside the orchestrator: they read and write the database.
 */
export const remoteTaskTypes = [
  "fetch",
  "extract",
  "structure",
  "analyze",
  "match",
  "select",
  "compose",
  "adapt",
  "review",
  "repair",
  "fallback",
  "fit",
  "ats-check",
  "store",
  "texts",
  "channel",
  "send",
] as const satisfies readonly AtelierTaskType[];
export type RemoteTaskType = (typeof remoteTaskTypes)[number];

/** Steps that call the model through llm-gateway. */
export const llmTaskTypes: readonly AtelierTaskType[] = [
  "analyze",
  "match",
  "compose",
  "review",
  "repair",
  "texts",
  "send",
];
