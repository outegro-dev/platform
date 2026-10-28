"use client";

import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import { GrumbleIcon } from "@outegro/ui/grumble-icon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { buyWithGrumbles } from "@/app/actions";
import type { GrumbleOutcome } from "@/lib/payments/model";

type Step = "idle" | "confirm" | "busy";

/**
 * "Buy for N grumbles" (wallet phase 3): a confirmation, then the server's
 * answer. Not enough grumbles shows how many are missing and the pack that
 * covers them, on this page. One key per confirmed attempt: a repeat after
 * a lost answer reuses it, so the wallet is never charged twice.
 */
export function GrumbleBuy({
  productKey,
  price,
}: {
  productKey: string;
  price: string;
}) {
  const t = useTranslations("catalog");
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [outcome, setOutcome] = useState<GrumbleOutcome | null>(null);
  const key = useRef<string | null>(null);
  const buyButton = useRef<HTMLButtonElement>(null);
  const spendButton = useRef<HTMLButtonElement>(null);
  const answered = useRef(false);
  const amount = t("grumbles", { count: Number(price) });

  // The buttons swap places: focus follows, so it is never dropped on the
  // page (a keyboard user would start over; phones show the skip link).
  useEffect(() => {
    if (step === "confirm") spendButton.current?.focus();
    else if (step === "idle" && answered.current) {
      answered.current = false;
      buyButton.current?.focus();
    }
  }, [step]);

  async function spend() {
    setStep("busy");
    key.current ??= `pw-g-${crypto.randomUUID()}`;
    const result = await buyWithGrumbles({
      productKey,
      idempotencyKey: key.current,
    });
    // Only an unknown answer keeps its key for the retry.
    if (result.kind !== "unavailable") key.current = null;
    setOutcome(result);
    answered.current = true;
    setStep("idle");
    if (result.kind === "paid" || result.kind === "owned") router.refresh();
  }

  let message: React.ReactNode = null;
  let tone: "neutral" | "pending" | "error" = "neutral";
  if (step === "busy") {
    tone = "pending";
    message = t("grumblesBusy");
  } else if (outcome) {
    switch (outcome.kind) {
      case "paid":
        message =
          outcome.balanceAfter === null
            ? t("grumblesPaidNoBalance")
            : t("grumblesPaid", {
                balance: t("grumbles", { count: Number(outcome.balanceAfter) }),
              });
        break;
      case "short":
        tone = "error";
        message = (
          <span>
            {t("grumblesShort", {
              shortfall: t("grumbles", { count: Number(outcome.shortfall) }),
            })}{" "}
            {outcome.pack && (
              <Link
                className="underline underline-offset-4"
                href={`#${outcome.pack.key}`}
              >
                {t("grumblesTopUp", {
                  pack: t("grumbles", { count: Number(outcome.pack.grumbles) }),
                })}
              </Link>
            )}
          </span>
        );
        break;
      case "owned":
        message = t("grumblesOwned");
        break;
      case "restricted":
        tone = "error";
        message = t("grumblesRestricted");
        break;
      case "unauthorized":
        tone = "error";
        message = t("problem.signedOut");
        break;
      case "unavailable":
        tone = "error";
        message = t("grumblesUnavailable");
        break;
      default:
        tone = "error";
        message = t("grumblesFailed");
    }
  }

  return (
    <div className="grumble-buy">
      {step !== "idle" ? (
        // Stays while paying: the focused button only turns pending.
        <fieldset className="grumble-confirm">
          <legend>{t("grumblesConfirm", { amount })}</legend>
          <div className="product-action">
            <Button
              size="lg"
              ref={spendButton}
              pending={step === "busy"}
              pendingLabel={t("grumblesBusy")}
              onClick={() => void spend()}
            >
              {t("grumblesYes")}
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={step === "busy"}
              onClick={() => {
                answered.current = true;
                setStep("idle");
              }}
            >
              {t("grumblesNo")}
            </Button>
          </div>
        </fieldset>
      ) : (
        <Button
          ref={buyButton}
          size="lg"
          variant="outline"
          onClick={() => {
            setOutcome(null);
            setStep("confirm");
          }}
        >
          <GrumbleIcon aria-hidden="true" />
          {t("forGrumbles", { amount })}
        </Button>
      )}
      {message && (
        <FormMessage tone={tone} lines={2} aria-live="polite">
          {message}
        </FormMessage>
      )}
    </div>
  );
}
