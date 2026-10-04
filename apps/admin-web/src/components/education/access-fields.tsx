"use client";

import { Input } from "@outegro/ui/input";
import { useId, useState } from "react";
import type { AccessMode, FeaturePreset } from "@/lib/education";

type Props = {
  mode: AccessMode;
  preset: FeaturePreset;
  previewChapters: number;
  /** The book's chapters: the most that can be free. */
  chapters: number;
  modes: { value: AccessMode; label: string; hint: string }[];
  presets: { value: FeaturePreset; label: string }[];
  labels: {
    mode: string;
    features: string;
    featuresHint: string;
    preview: string;
    previewHint: string;
  };
};

/**
 * The fields of a book's access rule inside the confirm dialog. Each field
 * posts a single value (FormData keeps only the last of repeated names);
 * the server action turns them into the contract's rule. Features and free
 * chapters exist only for a paid book.
 */
export function AccessRuleFields({
  mode: initial,
  preset,
  previewChapters,
  chapters,
  modes,
  presets,
  labels,
}: Props) {
  const id = useId();
  const [mode, setMode] = useState<AccessMode>(initial);
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-mode`}>
          {labels.mode}
        </label>
        <select
          id={`${id}-mode`}
          name="mode"
          className="select"
          value={mode}
          onChange={(event) => setMode(event.target.value as AccessMode)}
          aria-describedby={`${id}-mode-hint`}
        >
          {modes.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span id={`${id}-mode-hint`} className="field-hint">
          {modes.find((option) => option.value === mode)?.hint}
        </span>
      </div>
      {mode === "grant" && (
        <>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-features`}>
              {labels.features}
            </label>
            <select
              id={`${id}-features`}
              name="features"
              className="select"
              defaultValue={preset}
              aria-describedby={`${id}-features-hint`}
            >
              {presets.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span id={`${id}-features-hint`} className="field-hint">
              {labels.featuresHint}
            </span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-preview`}>
              {labels.preview}
            </label>
            <Input
              id={`${id}-preview`}
              name="previewChapters"
              type="number"
              inputMode="numeric"
              min={0}
              max={chapters}
              step={1}
              required
              defaultValue={previewChapters}
              aria-describedby={`${id}-preview-hint`}
            />
            <span id={`${id}-preview-hint`} className="field-hint">
              {labels.previewHint}
            </span>
          </div>
        </>
      )}
    </>
  );
}
