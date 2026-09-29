"use client";

import { nicknameSchema } from "@outegro/contracts/battleship";
import { Button } from "@outegro/ui/button";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { SignOutIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useId, useState } from "react";
import { type NicknameState, updateNickname } from "@/app/actions";
import { SoundEngine } from "@/game/sound/sound-engine";
import { StableLabel } from "../home/modes";
import { useRoot } from "../providers";

/** Nickname (validated like the server does; 409 means taken) and sound. */
export const Settings = observer(function Settings() {
  const { session, preferences, sound } = useRoot();
  const t = useTranslations("profile");
  const [state, action, pending] = useActionState<NicknameState, FormData>(
    updateNickname,
    { status: "idle" },
  );
  const [value, setValue] = useState(session.nickname ?? "");
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const soundId = useId();

  useEffect(() => {
    if (state.status === "saved" && state.profile) {
      session.setProfile(state.profile);
      setTouched(false);
    }
  }, [state, session]);

  const localInvalid = touched && !nicknameSchema.safeParse(value).success;
  const status =
    touched && localInvalid ? "invalid" : touched ? "idle" : state.status;
  const message =
    status === "invalid"
      ? t("nicknameInvalid")
      : status === "taken"
        ? t("nicknameTaken")
        : status === "unavailable"
          ? t("unavailable")
          : status === "signed-out"
            ? t("signedOut")
            : status === "saved"
              ? t("saved")
              : t("nicknameHint");
  const tone =
    status === "saved" ? "ok" : status === "idle" ? undefined : "error";

  return (
    <section
      className="card"
      aria-labelledby="settings-title"
      data-testid="settings"
    >
      <h2 id="settings-title">{t("settings")}</h2>
      <form
        action={action}
        className="field"
        noValidate
        onSubmit={(event) => {
          if (!nicknameSchema.safeParse(value).success) {
            event.preventDefault();
            setTouched(true);
          } else {
            setTouched(false);
          }
        }}
      >
        <Label htmlFor={inputId}>{t("nickname")}</Label>
        <div className="field-row">
          <Input
            id={inputId}
            name="nickname"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setTouched(true);
            }}
            maxLength={20}
            autoComplete="nickname"
            spellCheck={false}
            aria-invalid={tone === "error" || undefined}
            aria-describedby={hintId}
          />
          <Button type="submit" disabled={pending} data-testid="save-nickname">
            <StableLabel active={pending} on={t("saving")} off={t("save")} />
          </Button>
        </div>
        <p id={hintId} className="field-hint" data-tone={tone} role="status">
          {message}
        </p>
      </form>
      <div className="setting-row">
        <div>
          <p id={soundId} className="setting-label">
            {t("sound")}
          </p>
          <p className="small muted">{t("soundHint")}</p>
        </div>
        <span className="switch-wrap">
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={preferences.sound}
            aria-labelledby={soundId}
            data-testid="sound-toggle"
            onClick={() => {
              const next = !preferences.sound;
              preferences.setSound(next);
              if (next && sound instanceof SoundEngine) {
                sound.unlock();
                sound.play("place");
              }
            }}
          />
        </span>
      </div>
    </section>
  );
});

export function AccountCard() {
  const t = useTranslations("profile");
  return (
    <section className="card" aria-labelledby="account-title">
      <h2 id="account-title">{t("account")}</h2>
      <p>{t("accountHint")}</p>
      <form action="/auth/sign-out" method="post">
        <Button type="submit" variant="outline" data-testid="sign-out">
          <SignOutIcon />
          {t("signOut")}
        </Button>
      </form>
    </section>
  );
}
