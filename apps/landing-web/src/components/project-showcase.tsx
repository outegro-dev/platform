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
