"use client";

import { fairRoundSchema } from "@outegro/contracts/roulette";
import { Button } from "@outegro/ui/button";
import { CheckCircleIcon, InfoIcon, XCircleIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import {
  checkFair,
  type FairOutcome,
  normalizeSeed,
  validFairInput,
} from "@/game/fair-check";

type Result =
  | { kind: "checked"; outcome: FairOutcome; published: number | null }
  | { kind: "notRevealed"; round: number }
  | { kind: "notFound"; round: number }
  | { kind: "failed" }
  | { kind: "invalid" };

/**
 * Checks a round in the browser: the server's data for it, then the link
 * and the number recomputed here with WebCrypto. The manual form needs no
 * server at all.
 */
export function FairChecker({
  initialRound,
  publicSeed,
}: {
  initialRound: number | null;
  publicSeed: string | null;
}) {
  const t = useTranslations("fair");
  const [round, setRound] = useState(initialRound ? String(initialRound) : "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const roundId = useId();

  async function check(event: FormEvent) {
    event.preventDefault();
    const number = Number(round.trim());
    if (!Number.isSafeInteger(number) || number < 1) {
      setResult({ kind: "invalid" });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/rounds/${number}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (response.status === 404) {
        setResult({ kind: "notFound", round: number });
        return;
      }
      const body = fairRoundSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!response.ok || !body.success) {
        setResult({ kind: "failed" });
        return;
      }
      const data = body.data;
      if (!data.seed) {
        setResult({ kind: "notRevealed", round: number });
        return;
      }
      const outcome = await checkFair({
        seed: data.seed,
        previousSeed: data.previousSeed,
        publicSeed: data.publicSeed,
        round: data.round,
        published: data.number,
      });
      setResult({ kind: "checked", outcome, published: data.number });
    } catch {
      setResult({ kind: "failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fair-tools">
      <section className="fair-card" aria-labelledby={`${roundId}-title`}>
        <h2 id={`${roundId}-title`}>{t("checkTitle")}</h2>
        <form className="fair-row" onSubmit={check}>
          <label htmlFor={roundId}>{t("round")}</label>
          <input
            id={roundId}
            className="fair-input fair-input-short"
            inputMode="numeric"
            autoComplete="off"
            value={round}
            onChange={(event) => setRound(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? t("checking") : t("check")}
          </Button>
        </form>
        <ResultView result={result} />
      </section>
      <ManualCheck defaultPublicSeed={publicSeed ?? ""} />
    </div>
  );
}

function ManualCheck({ defaultPublicSeed }: { defaultPublicSeed: string }) {
  const t = useTranslations("fair");
  const id = useId();
  const [seed, setSeed] = useState("");
  const [previous, setPrevious] = useState("");
  const [publicSeed, setPublicSeed] = useState(defaultPublicSeed);
  const [round, setRound] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function compute(event: FormEvent) {
    event.preventDefault();
    const input = {
      seed: normalizeSeed(seed),
      previousSeed: previous.trim() ? normalizeSeed(previous) : null,
      publicSeed: publicSeed.trim(),
      round: Number(round.trim()),
    };
    if (!validFairInput(input)) {
      setResult({ kind: "invalid" });
      return;
    }
    setResult({
      kind: "checked",
      outcome: await checkFair(input),
      published: null,
    });
  }

  return (
    <section className="fair-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("manualTitle")}</h2>
      <p className="fair-muted">{t("manualLead")}</p>
      <form className="fair-form" onSubmit={compute}>
        <label htmlFor={`${id}-seed`}>{t("seed")}</label>
        <input
          id={`${id}-seed`}
          className="fair-input"
          spellCheck={false}
          autoComplete="off"
          value={seed}
          onChange={(event) => setSeed(event.target.value)}
        />
        <label htmlFor={`${id}-previous`}>{t("previousSeed")}</label>
        <input
          id={`${id}-previous`}
          className="fair-input"
          spellCheck={false}
          autoComplete="off"
          value={previous}
          onChange={(event) => setPrevious(event.target.value)}
        />
        <label htmlFor={`${id}-public`}>{t("manualPublicSeed")}</label>
        <input
          id={`${id}-public`}
          className="fair-input"
          spellCheck={false}
          autoComplete="off"
          value={publicSeed}
          onChange={(event) => setPublicSeed(event.target.value)}
        />
        <label htmlFor={`${id}-round`}>{t("manualRound")}</label>
        <input
          id={`${id}-round`}
          className="fair-input fair-input-short"
          inputMode="numeric"
          autoComplete="off"
          value={round}
          onChange={(event) => setRound(event.target.value)}
        />
        <div>
          <Button type="submit" size="sm" variant="outline">
            {t("compute")}
          </Button>
        </div>
      </form>
      <ResultView result={result} />
    </section>
  );
}

function ResultView({ result }: { result: Result | null }) {
  const t = useTranslations("fair");
  const colors = useTranslations("colors");
  if (!result) return null;
  if (result.kind !== "checked") {
    const text =
      result.kind === "notRevealed"
        ? t("notRevealed", { round: result.round })
        : result.kind === "notFound"
          ? t("notFound", { round: result.round })
          : t(result.kind);
    return (
      <p className="fair-result" role="status">
        <InfoIcon aria-hidden="true" />
        {text}
      </p>
    );
  }
  const { outcome, published } = result;
  return (
    <ul className="fair-result-list" role="status" data-testid="fair-result">
      {outcome.linkOk === null ? null : (
        <li data-ok={outcome.linkOk}>
          {outcome.linkOk ? (
            <CheckCircleIcon aria-hidden="true" />
          ) : (
            <XCircleIcon aria-hidden="true" />
          )}
          {outcome.linkOk ? t("linkOk") : t("linkBad")}
        </li>
      )}
      <li>
        <span className={`pf-n rl-${outcome.color}`} aria-hidden="true">
          {outcome.number}
        </span>
        {t("number", {
          number: outcome.number,
          color: colors(outcome.color),
        })}
      </li>
      {outcome.matches === null ? null : (
        <li data-ok={outcome.matches}>
          {outcome.matches ? (
            <CheckCircleIcon aria-hidden="true" />
          ) : (
            <XCircleIcon aria-hidden="true" />
          )}
          {outcome.matches
            ? t("match")
            : t("mismatch", { number: published ?? "—" })}
        </li>
      )}
    </ul>
  );
}
