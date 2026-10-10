import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import Image, { type StaticImageData } from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import battleEn from "@/assets/battleship/battle-en.webp";
import battleRu from "@/assets/battleship/battle-ru.webp";
import leaderboardEn from "@/assets/battleship/leaderboard-en.webp";
import leaderboardRu from "@/assets/battleship/leaderboard-ru.webp";
import lobbyEn from "@/assets/battleship/lobby-phone-en.webp";
import lobbyRu from "@/assets/battleship/lobby-phone-ru.webp";
import placementEn from "@/assets/battleship/placement-en.webp";
import placementRu from "@/assets/battleship/placement-ru.webp";
import profileEn from "@/assets/battleship/profile-en.webp";
import profileRu from "@/assets/battleship/profile-ru.webp";

type Shot = "battle" | "lobby" | "placement" | "leaderboard" | "profile";

// 2x captures of the game in each language (tools/quality/capture-battleship.mjs).
const shots: Record<"en" | "ru", Record<Shot, StaticImageData>> = {
  en: {
    battle: battleEn,
    lobby: lobbyEn,
    placement: placementEn,
    leaderboard: leaderboardEn,
    profile: profileEn,
  },
  ru: {
    battle: battleRu,
    lobby: lobbyRu,
    placement: placementRu,
    leaderboard: leaderboardRu,
    profile: profileRu,
  },
};

const GAME = "https://battleship.outegro.dev";

/**
 * Red felt-tip marks over the battle screenshot, the way a magazine circles
 * what matters: the expert bot, a sunk ship and the Elo rating. Positions are
 * percentages of the 16:10 capture.
 */
function Marks({
  labels,
}: {
  labels: { bot: string; sunk: string; elo: string };
}) {
  return (
    <div className="marks" aria-hidden="true">
      <svg viewBox="0 0 100 62.5" preserveAspectRatio="none">
        <title>marks</title>
        <path d="M80.5 7.6c4.6-2.4 14-2.1 16.2 1.4 1.9 3.3-4.3 6.6-10.2 6.9-6.4.4-10.9-2.2-9.4-5.4.8-1.6 2.4-2.6 4.6-3.2" />
        <path d="M79.6 48.6c3.2-1.6 7.6 1.1 7.8 5.9.3 5.4-2.6 8.5-5.6 7.8-3.4-.8-4.6-5.6-3.6-9.6.4-1.7 1.3-3.2 2.6-4" />
        <path d="M26 12.6c-3.9-1.3-7.6-1.5-11.4-.9m0 0 2.4-1.6m-2.4 1.6 2.2 1.8" />
      </svg>
      <span className="mark-note is-bot">{labels.bot}</span>
      <span className="mark-note is-sunk">{labels.sunk}</span>
      <span className="mark-note is-elo">{labels.elo}</span>
    </div>
  );
}

/**
 * The live product, shown as it is: the game in a browser and on a phone,
 * three more screens, what it does and what it runs on. Every image has its
 * box reserved by aspect ratio and loads lazily below the hero.
 */
export async function ProjectShowcase() {
  const t = await getTranslations("projects");
  const set = shots[(await getLocale()) === "ru" ? "ru" : "en"];
  const features = t.raw("features") as string[];
  const stack = t.raw("stack") as string[];
  const shot = (key: Shot, sizes: string) => (
    <Image
      src={set[key]}
      alt={t(`shots.${key}.alt`)}
      sizes={sizes}
      placeholder="empty"
    />
  );

  return (
    <article className="project" aria-labelledby="project-name">
      {/* Duotone "printed in the magazine" look for the screenshots (zine-page.css). */}
      <svg className="print-filter" width="0" height="0" aria-hidden="true">
        <filter id="zine-print" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0"
          />
          <feComponentTransfer>
            <feFuncR type="linear" slope="1.35" intercept="-0.2" />
            <feFuncG type="linear" slope="1.35" intercept="-0.2" />
            <feFuncB type="linear" slope="1.35" intercept="-0.2" />
          </feComponentTransfer>
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.1 0.98" />
            <feFuncG type="table" tableValues="0.2 0.96" />
            <feFuncB type="table" tableValues="0.42 0.9" />
          </feComponentTransfer>
        </filter>
      </svg>
      <header className="project-head" data-reveal>
        <div className="project-title">
          <h3 id="project-name">{t("name")}</h3>
          <p className="live-status">
            <span className="live-dot" aria-hidden="true" />
            {t("status")}
          </p>
        </div>
        <p className="project-summary">{t("summary")}</p>
        <div className="project-actions">
          <Button asChild size="lg">
            <a href={GAME}>
              {t("play")}
              <ArrowUpRightIcon />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="/stack">{t("howBuilt")}</a>
          </Button>
        </div>
      </header>

      <div className="project-stage" data-reveal>
        <figure className="shot">
          <div className="browser">
            <div className="browser-bar" aria-hidden="true">
              <span className="browser-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="browser-url">battleship.outegro.dev</span>
            </div>
            <div className="shot-screen is-desktop">
              {shot(
                "battle",
                "(max-width: 767px) 100vw, (max-width: 1600px) 74vw, 1140px",
              )}
              <Marks
                labels={{
                  bot: t("marks.bot"),
                  sunk: t("marks.sunk"),
                  elo: t("marks.elo"),
                }}
              />
            </div>
          </div>
          <figcaption>{t("shots.battle.caption")}</figcaption>
        </figure>
        <figure className="shot shot-phone">
          <div className="phone">
            <div className="shot-screen is-phone">
              {shot("lobby", "(max-width: 767px) 62vw, 340px")}
            </div>
          </div>
          <figcaption>{t("shots.lobby.caption")}</figcaption>
        </figure>
      </div>

      <ul className="project-shots" data-reveal>
        {(["placement", "leaderboard", "profile"] as const).map((key) => (
          <li key={key}>
            <figure className="shot">
              <div className="shot-screen is-desktop is-framed">
                {shot(
                  key,
                  "(max-width: 767px) 100vw, (max-width: 1600px) 31vw, 480px",
                )}
              </div>
              <figcaption>{t(`shots.${key}.caption`)}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
      <p className="og-eyebrow project-note">{t("note")}</p>

      <div className="project-facts" data-reveal>
        <div>
          <h4 className="og-eyebrow">{t("featuresTitle")}</h4>
          <ul className="project-features">
            {features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="og-eyebrow">{t("stackTitle")}</h4>
          <ul className="badge-list">
            {stack.map((tech) => (
              <li key={tech}>
                <Badge>{tech}</Badge>
              </li>
            ))}
          </ul>
          <p className="project-account">
            {t.rich("account", {
              id: (chunks) => <a href="https://id.outegro.dev">{chunks}</a>,
              pay: (chunks) => <a href="https://pay.outegro.dev">{chunks}</a>,
            })}
          </p>
        </div>
      </div>
    </article>
  );
}
