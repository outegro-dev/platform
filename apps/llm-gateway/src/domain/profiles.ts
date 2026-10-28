import { readFileSync } from "node:fs";
import type { LlmProfile } from "@outegro/contracts/atelier";
import { z } from "zod";

export const providerIds = ["codex", "claude", "minimax"] as const;
export const providerIdSchema = z.enum(providerIds);
export type ProviderId = z.infer<typeof providerIdSchema>;

const providerSettingsSchema = z.strictObject({
  /** Calls at once; the next ones wait in a FIFO queue. */
  concurrency: z.number().int().min(1).max(20),
  /** One call when the request names no timeoutMs. */
  timeoutMs: z.number().int().min(10_000).max(3_600_000),
  /** HTTP providers only. */
  baseUrl: z.url().optional(),
  /** Waits before repeating a call refused as overloaded (502/503/529). */
  overloadRetryMs: z.array(z.number().int().min(0).max(120_000)).optional(),
});
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

const profileSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),
  label: z.string().min(1).max(120),
  provider: providerIdSchema,
  model: z.string().min(1).max(100),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  /** MiniMax: extended thinking (the tool is then asked for in the prompt). */
  thinking: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
});
export type Profile = z.infer<typeof profileSchema>;

/** The profiles file: no secrets, keys come from the environment. */
export const profilesFileSchema = z
  .strictObject({
    providers: z.partialRecord(providerIdSchema, providerSettingsSchema),
    profiles: z.array(profileSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.profiles.forEach((profile, index) => {
      if (seen.has(profile.id))
        ctx.addIssue({
          code: "custom",
          path: ["profiles", index, "id"],
          message: `Duplicate profile ${profile.id}`,
        });
      seen.add(profile.id);
      if (!file.providers[profile.provider])
        ctx.addIssue({
          code: "custom",
          path: ["profiles", index, "provider"],
          message: `No settings for provider ${profile.provider}`,
        });
    });
  });
export type ProfilesFile = z.infer<typeof profilesFileSchema>;

export function parseProfiles(input: unknown): ProfilesFile {
  return profilesFileSchema.parse(input);
}

export function loadProfiles(path: string): ProfilesFile {
  return parseProfiles(JSON.parse(readFileSync(path, "utf8")));
}

/** The public view of a profile (GET /v1/profiles). */
export const profileView = (profile: Profile): LlmProfile => ({
  id: profile.id,
  label: profile.label,
  provider: profile.provider,
  model: profile.model,
  reasoningEffort: profile.reasoningEffort ?? null,
});
