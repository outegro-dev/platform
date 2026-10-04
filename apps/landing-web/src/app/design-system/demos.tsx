"use client";

import { Button } from "@outegro/ui/button";
import { CopyButton } from "@outegro/ui/copy-button";
import { Progress } from "@outegro/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@outegro/ui/toggle-group";
import { useId, useState } from "react";

/** A segmented control driving a progress bar: the fill slides, never resizes. */
export function ProgressDemo({
  label,
  options,
}: {
  label: string;
  options: { value: number; text: string }[];
}) {
  const id = useId();
  const [value, setValue] = useState(options[1]?.value ?? 0);
  const text = options.find((option) => option.value === value)?.text ?? "";
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id={id} className="text-sm font-medium">
          {label}
        </span>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          value={String(value)}
          onValueChange={(next) => setValue(Number(next))}
          aria-labelledby={id}
        >
          {options.map((option) => (
            <ToggleGroupItem key={option.value} value={String(option.value)}>
              {option.text}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <Progress
        aria-labelledby={id}
        value={value}
        valueText={text}
        tone={value >= 100 ? "ok" : "accent"}
      />
    </div>
  );
}

/**
 * A small button that is busy: the spinner covers the kept label, the size
 * and the 44 px target stay. (Pending guards clicks with a handler, so it
 * renders on the client.)
 */
export function PendingButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  return (
    <Button size="sm" variant="outline" pending pendingLabel={pendingLabel}>
      {label}
    </Button>
  );
}

/** A clipboard that refuses: the value cannot be read, so the copy fails. */
export function RefusedCopy(props: {
  label: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  return (
    <CopyButton
      variant="outline"
      value={() => {
        throw new Error("Clipboard unavailable in this demo");
      }}
      {...props}
    />
  );
}
