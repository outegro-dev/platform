"use client";

import { Button } from "@outegro/ui/button";
import { Input } from "@outegro/ui/input";
import {
  ArrowRightIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { changeDaily } from "@/app/(console)/roulette/actions";
import { CommandDialog } from "@/components/ui/command-dialog";
import type {
  DailyPreview,
  DailyPrize,
  DailySettings,
} from "@/lib/adapters/daily";
import { formatNumber } from "@/lib/format";
import {
  chanceSum,
  expectedPrize,
  grm,
  type PrizeRow,
  prizeTableOf,
  rowsOf,
  samePrizes,
} from "@/lib/roulette";

/** An expected prize: grumbles with up to two decimals (an average). */
const average = (value: number, locale: string) =>
  `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)} ${grm}`;

const percent = (chance: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 4,
  }).format(chance);

function PrizeList({
  prizes,
  label,
}: {
  prizes: readonly DailyPrize[];
  label: string;
}) {
  const t = useTranslations("roulette.daily");
  const locale = useLocale();
  return (
    <table className="table rl-prizes" data-compact="">
      <caption className="rl-prizes-caption">{label}</caption>
      <thead>
        <tr>
          <th scope="col" className="num">
            {t("colAmount")}
          </th>
          <th scope="col" className="num">
            {t("colChance")}
          </th>
        </tr>
      </thead>
      <tbody>
        {prizes.map((prize, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines of a table may repeat; their place is their identity.
          <tr key={index}>
            <td className="num">
              {formatNumber(prize.amount, locale)} {grm}
            </td>
            <td className="num">{percent(prize.chance, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Preview({ preview }: { preview: DailyPreview }) {
  const t = useTranslations("roulette.daily");
  const locale = useLocale();
  const { before, after } = preview;
  const switches = (["enabled", "streaksEnabled"] as const).filter(
    (field) => before[field] !== after[field],
  );
  const prizes = !samePrizes(before.prizes, after.prizes);
  return (
    <div className="stack-sm">
      <ul className="rl-diff" aria-label={t("changes")}>
        {switches.map((field) => (
          <li key={field}>
            <span className="rl-diff-field">{t(`fields.${field}`)}</span>
            <span className="rl-diff-values">
              <span className="sr-only">{t("was")} </span>
              <span>{t(before[field] ? "on" : "off")}</span>
              <ArrowRightIcon aria-hidden="true" />
              <span className="sr-only">, {t("now")} </span>
              <span className="rl-diff-after">
                {t(after[field] ? "on" : "off")}
              </span>
            </span>
          </li>
        ))}
        <li>
          <span className="rl-diff-field">{t("expectedPrize")}</span>
          <span className="rl-diff-values">
            <span className="sr-only">{t("was")} </span>
            <span className="num">
              {average(preview.expectedPrizeBefore, locale)}
            </span>
            <ArrowRightIcon aria-hidden="true" />
            <span className="sr-only">, {t("now")} </span>
            <span className="num rl-diff-after">
              {average(preview.expectedPrizeAfter, locale)}
            </span>
          </span>
        </li>
      </ul>
      {prizes && (
        <div className="grid-2 rl-prize-diff">
          <PrizeList prizes={before.prizes} label={t("prizesBefore")} />
          <PrizeList prizes={after.prizes} label={t("prizesAfter")} />
        </div>
      )}
    </div>
  );
}

const unchanged = ({ before, after }: DailyPreview) =>
  before.enabled === after.enabled &&
  before.streaksEnabled === after.streaksEnabled &&
  samePrizes(before.prizes, after.prizes);

/**
 * The bonus of the day (roulette.manage): on or off, streaks, and the prize
 * table, whose chances must sum to 100 %. The expected prize is shown as it
 * is and as it would be while typing; the preview is the service's own.
 */
export function DailyCommand({ settings }: { settings: DailySettings }) {
  const t = useTranslations("roulette.daily");
  const locale = useLocale();
  const id = useId();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [streaks, setStreaks] = useState(settings.streaksEnabled);
  const [rows, setRows] = useState<PrizeRow[]>(() => rowsOf(settings.prizes));
  const table = prizeTableOf(rows);
  const typed = rows.map((row) => ({
    chance: Number(row.percent.replace(",", ".")) / 100 || 0,
  }));
  const sum = chanceSum(typed);
  const update = (index: number, patch: Partial<PrizeRow>) =>
    setRows((current) =>
      current.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );
  return (
    <CommandDialog<DailyPreview>
      action={changeDaily}
      triggerLabel={t("edit")}
      triggerIcon={<PencilSimpleIcon aria-hidden="true" />}
      title={t("editTitle")}
      description={t("editDescription")}
      consequences={[t("effectNext"), t("audited")]}
      confirmLabel={t("confirm")}
      hidden={{
        enabled: String(enabled),
        streaksEnabled: String(streaks),
        prizes: JSON.stringify(table.ok ? table.prizes : []),
        expectedVersion: String(settings.version),
      }}
      ready={table.ok}
      renderPreview={(preview) => <Preview preview={preview} />}
      unchanged={unchanged}
    >
      <label className="check-field rl-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>
          <strong>{t("fields.enabled")}</strong>
          <br />
          <span className="muted">{t("hints.enabled")}</span>
        </span>
      </label>
      <label className="check-field rl-check">
        <input
          type="checkbox"
          checked={streaks}
          onChange={(event) => setStreaks(event.target.checked)}
        />
        <span>
          <strong>{t("fields.streaksEnabled")}</strong>
          <br />
          <span className="muted">{t("hints.streaksEnabled")}</span>
        </span>
      </label>
      <fieldset className="rl-editor">
        <legend className="field-label">{t("prizes")}</legend>
        <ol className="rl-editor-rows">
          {rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place; removing one re-numbers the rest.
            <li key={index} className="rl-editor-row">
              <div className="field">
                <label
                  className="field-label"
                  htmlFor={`${id}-amount-${index}`}
                >
                  {t("amountN", { n: index + 1 })}
                </label>
                <Input
                  id={`${id}-amount-${index}`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={row.amount}
                  onChange={(event) =>
                    update(index, { amount: event.target.value })
                  }
                />
              </div>
              <div className="field">
                <label
                  className="field-label"
                  htmlFor={`${id}-chance-${index}`}
                >
                  {t("chanceN", { n: index + 1 })}
                </label>
                <Input
                  id={`${id}-chance-${index}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={row.percent}
                  onChange={(event) =>
                    update(index, { percent: event.target.value })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={rows.length < 2}
                aria-label={t("removeN", { n: index + 1 })}
                onClick={() =>
                  setRows((current) => current.filter((_, at) => at !== index))
                }
              >
                <TrashIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
        <div className="row-gap" style={{ justifyContent: "space-between" }}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rows.length >= 20}
            onClick={() =>
              setRows((current) => [...current, { amount: "", percent: "" }])
            }
          >
            <PlusIcon aria-hidden="true" />
            {t("addRow")}
          </Button>
          <span className="small num" data-tone={table.ok ? undefined : "bad"}>
            {t("sum", {
              sum: new Intl.NumberFormat(locale, {
                maximumFractionDigits: 4,
              }).format(sum * 100),
            })}
          </span>
        </div>
      </fieldset>
      <dl className="facts rl-expected">
        <div className="fact">
          <dt>{t("expectedNow")}</dt>
          <dd className="num">
            {average(expectedPrize(settings.prizes), locale)}
          </dd>
        </div>
        <div className="fact">
          <dt>{t("expectedAfter")}</dt>
          <dd className="num">
            {table.ok ? average(expectedPrize(table.prizes), locale) : "—"}
          </dd>
        </div>
      </dl>
      <p
        className="form-status"
        role="status"
        data-tone={table.ok ? undefined : "bad"}
      >
        {table.ok ? "" : t(`problems.${table.problem}`)}
      </p>
    </CommandDialog>
  );
}
