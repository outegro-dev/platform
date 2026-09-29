"use client";

import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PremiumBadge } from "../chrome/player-chip";
import { useRoot } from "../providers";

/** Your rating, record and Premium state, live from the session. */
export const RatingCard = observer(function RatingCard() {
  const { session } = useRoot();
  const t = useTranslations("rating");
  const p = useTranslations("player");
  const profile = session.profile;
  const matches = profile?.matches ?? 0;
  const wins = profile?.wins ?? 0;
  return (
    <section
      className="card rating-card"
      aria-labelledby="rating-title"
      data-testid="rating-card"
    >
      <div className="card-head">
        <h2 id="rating-title" className="og-eyebrow">
          {t("title")}
        </h2>
        {profile?.provisional ? (
          <Badge variant="muted">{p("provisional")}</Badge>
        ) : null}
      </div>
      <p className="rating-value" data-testid="rating-value">
        {session.rating ?? "—"}
      </p>
      <div className="rating-meta">
        <span>{t("matches", { count: matches })}</span>
        {matches > 0 ? (
          <span className="tabular">
            {t("record", { wins, losses: Math.max(0, matches - wins) })}
          </span>
        ) : null}
      </div>
      <div className="rating-meta">
        {session.premium ? (
          <PremiumBadge label={t("premiumActive")} />
        ) : (
          <Button asChild variant="link" size="sm" className="px-0">
            <Link href="/shop">
              {t("getPremium")}
              <ArrowRightIcon />
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
});
