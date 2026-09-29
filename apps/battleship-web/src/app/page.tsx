import { Button } from "@outegro/ui/button";
import {
  LightningIcon,
  LinkIcon,
  RobotIcon,
  SignInIcon,
  TrophyIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DemoBoard } from "@/components/board/demo-board";
import { FleetRules } from "@/components/home/fleet-rules";
import { MiniLeaderboard } from "@/components/home/mini-leaderboard";
import { Modes } from "@/components/home/modes";
import { RatingCard } from "@/components/home/rating-card";
import { accessToken, loadLeaderboard } from "@/lib/api";
import { signInHref } from "@/lib/routes";

export default async function HomePage() {
  const signedIn = Boolean(await accessToken());
  const board = await loadLeaderboard("all");
  return (
    <main id="main" className="app-main og-container">
      {signedIn ? <SignedIn /> : <Guest />}
      <div className="home-lower">
        <MiniLeaderboard board={board} />
        <FleetRules />
      </div>
    </main>
  );
}

async function SignedIn() {
  const t = await getTranslations("home");
  return (
    <>
      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <p className="og-eyebrow">{t("eyebrow")}</p>
          <h1 id="home-title" className="hero-title">
            {t("title")}
            <span className="og-accent">{t("titleAccent")}</span>
          </h1>
          <p className="lead">{t("lead")}</p>
        </div>
        <RatingCard />
      </section>
      <h2 className="sr-only">{t("modesTitle")}</h2>
      <Modes />
    </>
  );
}

async function Guest() {
  const t = await getTranslations("home");
  const m = await getTranslations("modes");
  const modes = [
    { key: "bot", Icon: RobotIcon },
    { key: "quick", Icon: LightningIcon },
    { key: "room", Icon: LinkIcon },
  ] as const;
  return (
    <>
      <section className="home-hero guest-hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <p className="og-eyebrow">{t("guestEyebrow")}</p>
          <h1 id="home-title" className="hero-title">
            {t("guestTitle")}
            <span className="og-accent">{t("guestTitleAccent")}</span>
          </h1>
          <p className="lead">{t("guestLead")}</p>
          <div className="hero-actions">
            <Button asChild size="lg">
              <a href={signInHref("/")} data-testid="sign-in-cta">
                <SignInIcon />
                {t("signInToPlay")}
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/leaderboard">
                <TrophyIcon />
                {t("seeLeaderboard")}
              </Link>
            </Button>
          </div>
        </div>
        <div className="demo-stage">
          <DemoBoard label={t("demoLabel")} skin="silver" />
        </div>
      </section>
      <h2 className="sr-only">{t("modesTitle")}</h2>
      <div className="modes">
        {modes.map(({ key, Icon }) => (
          <article key={key} className="card mode-card">
            <div className="card-head">
              <span className="card-icon" aria-hidden="true">
                <Icon />
              </span>
            </div>
            <div className="mode-body">
              <h3>{m(`${key}.title`)}</h3>
              <p>{m(`${key}.lead`)}</p>
            </div>
            <span />
            <div className="card-actions">
              <Button asChild variant="outline" size="lg">
                <a href={signInHref("/")}>{t("signInToPlay")}</a>
              </Button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
