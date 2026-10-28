"use client";

import { Input } from "@outegro/ui/input";
import {
  ArrowRightIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { changeTable } from "@/app/(console)/roulette/actions";
import { CommandDialog } from "@/components/ui/command-dialog";
import type { TablePreview, TableSettings } from "@/lib/adapters/roulette";
import { formatNumber } from "@/lib/format";
import {
  type FieldChange,
  grm,
  type TableField,
  tableDiff,
} from "@/lib/roulette";

type Numbers = Record<
  "minBet" | "maxBet" | "betsPerRound" | "payoutLimitPerColor",
  string
>;

const numberFields = [
  "minBet",
  "maxBet",
  "betsPerRound",
  "payoutLimitPerColor",
] as const;

/** Whole positive numbers as typed, or null when one is not. */
function parsed(values: Numbers) {
  const out = {} as Record<keyof Numbers, number>;
  for (const field of numberFields) {
    const text = values[field].trim();
    const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value <= 0)
      return null;
    out[field] = value;
  }
  return out;
}

function ChangeList({ changes }: { changes: FieldChange[] }) {
  const t = useTranslations("roulette.table");
  const locale = useLocale();
  const value = (field: TableField, item: number | boolean) =>
    typeof item === "boolean"
      ? t(item ? "on" : "off")
      : field === "betsPerRound"
        ? formatNumber(item, locale)
        : `${formatNumber(item, locale)} ${grm}`;
  if (changes.length === 0) return null;
  return (
    <ul className="rl-diff" aria-label={t("changes")}>
      {changes.map((change) => (
        <li key={change.field}>
          <span className="rl-diff-field">{t(`fields.${change.field}`)}</span>
          <span className="rl-diff-values">
            <span className="sr-only">{t("was")} </span>
            <span className="num">{value(change.field, change.before)}</span>
            <ArrowRightIcon aria-hidden="true" />
            <span className="sr-only">, {t("now")} </span>
            <span className="num rl-diff-after">
              {value(change.field, change.after)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const previewOf = (preview: TablePreview) => (
  <ChangeList changes={tableDiff(preview.before, preview.after)} />
);
const unchanged = (preview: TablePreview) =>
  tableDiff(preview.before, preview.after).length === 0;

const hiddenOf = (
  settings: TableSettings,
  values: { paused: boolean; maintenance: boolean },
  numbers?: Numbers,
): Record<string, string> => ({
  ...(numbers
    ? {}
    : {
        minBet: String(settings.minBet),
        maxBet: String(settings.maxBet),
        betsPerRound: String(settings.betsPerRound),
        payoutLimitPerColor: String(settings.payoutLimitPerColor),
      }),
  paused: String(values.paused),
  maintenance: String(values.maintenance),
  expectedVersion: String(settings.version),
});

/** Limits and switches of the table in one form; the preview shows the diff. */
function EditTable({ settings }: { settings: TableSettings }) {
  const t = useTranslations("roulette.table");
  const id = useId();
  const [numbers, setNumbers] = useState<Numbers>({
    minBet: String(settings.minBet),
    maxBet: String(settings.maxBet),
    betsPerRound: String(settings.betsPerRound),
    payoutLimitPerColor: String(settings.payoutLimitPerColor),
  });
  const [paused, setPaused] = useState(settings.paused);
  const [maintenance, setMaintenance] = useState(settings.maintenance);
  const values = parsed(numbers);
  const problem = !values
    ? t("wholeNumbers")
    : values.minBet > values.maxBet
      ? t("minAboveMax")
      : values.betsPerRound > 20
        ? t("tooManyBets")
        : null;
  return (
    <CommandDialog<TablePreview>
      action={changeTable}
      triggerLabel={t("edit")}
      triggerIcon={<PencilSimpleIcon aria-hidden="true" />}
      title={t("editTitle")}
      description={t("editDescription")}
      consequences={[t("effectNext"), t("multipliers"), t("audited")]}
      confirmLabel={t("confirm")}
      hidden={hiddenOf(settings, { paused, maintenance }, numbers)}
      ready={problem === null}
      renderPreview={previewOf}
      unchanged={unchanged}
    >
      <div className="rl-fields">
        {numberFields.map((field) => (
          <div key={field} className="field">
            <label className="field-label" htmlFor={`${id}-${field}`}>
              {t(`fields.${field}`)}
            </label>
            <Input
              id={`${id}-${field}`}
              name={field}
              inputMode="numeric"
              autoComplete="off"
              value={numbers[field]}
              onChange={(event) =>
                setNumbers((current) => ({
                  ...current,
                  [field]: event.target.value,
                }))
              }
              aria-describedby={`${id}-${field}-hint`}
            />
            <span id={`${id}-${field}-hint`} className="field-hint">
              {t(`hints.${field}`)}
            </span>
          </div>
        ))}
      </div>
      <label className="check-field rl-check">
        <input
          type="checkbox"
          checked={paused}
          onChange={(event) => setPaused(event.target.checked)}
        />
        <span>
          <strong>{t("fields.paused")}</strong>
          <br />
          <span className="muted">{t("hints.paused")}</span>
        </span>
      </label>
      <label className="check-field rl-check">
        <input
          type="checkbox"
          checked={maintenance}
          onChange={(event) => setMaintenance(event.target.checked)}
        />
        <span>
          <strong>{t("fields.maintenance")}</strong>
          <br />
          <span className="muted">{t("hints.maintenance")}</span>
        </span>
      </label>
      <p
        className="form-status"
        role="status"
        data-tone={problem ? "bad" : undefined}
      >
        {problem ?? ""}
      </p>
    </CommandDialog>
  );
}

/** One switch flipped, everything else as it is. */
function Switch({
  settings,
  field,
}: {
  settings: TableSettings;
  field: "paused" | "maintenance";
}) {
  const t = useTranslations("roulette.table");
  const on = !settings[field];
  const key = `${field}${on ? "On" : "Off"}` as const;
  const icon =
    field === "paused" ? (
      on ? (
        <PauseIcon aria-hidden="true" />
      ) : (
        <PlayIcon aria-hidden="true" />
      )
    ) : (
      <WrenchIcon aria-hidden="true" />
    );
  return (
    <CommandDialog<TablePreview>
      action={changeTable}
      triggerLabel={t(`${key}.trigger`)}
      triggerIcon={icon}
      title={t(`${key}.title`)}
      description={t(`${key}.description`)}
      consequences={[t(`${key}.effect`), t("audited")]}
      confirmLabel={t(`${key}.confirm`)}
      destructive={on}
      hidden={hiddenOf(settings, {
        paused: field === "paused" ? on : settings.paused,
        maintenance: field === "maintenance" ? on : settings.maintenance,
      })}
      renderPreview={previewOf}
      unchanged={unchanged}
    />
  );
}

/** The table's commands (roulette.manage): pause bets, maintenance, the full form. */
export function TableCommands({ settings }: { settings: TableSettings }) {
  return (
    <div className="row-gap">
      <Switch settings={settings} field="paused" />
      <Switch settings={settings} field="maintenance" />
      <EditTable settings={settings} />
    </div>
  );
}
