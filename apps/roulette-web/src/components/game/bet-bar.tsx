"use client";

import { SpeakerHighIcon, SpeakerSlashIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { quickActions } from "@/game/amount";
import type { SoundBlips } from "@/game/sound";
import type { Notice, RouletteStore } from "@/game/stores/roulette-store";
import { GrumbleIcon } from "../grumble-icon";

const longNames = { half: "halfLabel", double: "doubleLabel" } as const;

/** The amount in grumbles, the quick buttons, the sound switch and the line that explains the last click. */
export const BetBar = observer(function BetBar({
  store,
  sound,
}: {
  store: RouletteStore;
  sound: SoundBlips;
}) {
  const t = useTranslations("amount");
  const id = useId();
  return (
    <div className="rl-betbar">
      <label className="rl-amount" htmlFor={id}>
        <GrumbleIcon className="size-5" />
        <span className="sr-only">{t("label")}</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={t("placeholder")}
          value={store.amount === 0 ? "" : String(store.amount)}
          onChange={(event) => store.setAmountText(event.target.value)}
        />
      </label>
      <fieldset className="rl-quick">
        <legend className="sr-only">{t("quick")}</legend>
        {quickActions.map((action) => (
          <button
            key={action}
            className="rl-q"
            type="button"
            onClick={() => store.quick(action)}
            aria-label={
              action in longNames
                ? t(longNames[action as keyof typeof longNames])
                : undefined
            }
          >
            {t(action)}
          </button>
        ))}
      </fieldset>
      <SoundSwitch sound={sound} />
      <NoticeLine store={store} />
    </div>
  );
});

/** Sound is off until the player says otherwise or acts; the choice is remembered. */
const SoundSwitch = observer(function SoundSwitch({
  sound,
}: {
  sound: SoundBlips;
}) {
  const t = useTranslations("sound");
  return (
    <button
      className="rl-q rl-sound"
      type="button"
      aria-pressed={sound.enabled}
      aria-label={t("label")}
      title={sound.enabled ? t("on") : t("off")}
      onClick={() => sound.toggle()}
    >
      {sound.enabled ? (
        <SpeakerHighIcon aria-hidden="true" />
      ) : (
        <SpeakerSlashIcon aria-hidden="true" />
      )}
    </button>
  );
});

const NoticeLine = observer(function NoticeLine({
  store,
}: {
  store: RouletteStore;
}) {
  const t = useTranslations();
  const notice = store.notice;
  const amount =
    notice.kind === "accepted"
      ? notice.amount
      : notice.kind === "won"
        ? notice.payout
        : null;
  return (
    <p
      className="rl-msg"
      aria-live="polite"
      data-kind={notice.kind}
      data-testid="bet-notice"
    >
      {amount !== null ? <GrumbleIcon className="rl-msg-coin" /> : null}
      {noticeText(notice, store, t)}
    </p>
  );
});

function noticeText(
  notice: Notice,
  store: RouletteStore,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (notice.kind) {
    case "hint":
      return t("notice.hint");
    case "accepted":
      return t("notice.accepted", {
        amount: notice.amount,
        color: t(`colors.${notice.color}`),
      });
    case "won":
      return t("notice.won", { payout: notice.payout });
    case "lost":
      return t("notice.lost");
    case "refused":
      return t(`refusal.${notice.code}`, {
        min: store.table?.minBet ?? 0,
        max: store.table?.maxBet ?? 0,
        count: store.table?.betsPerRound ?? 0,
      });
  }
}
