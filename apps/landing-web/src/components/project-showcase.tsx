import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import Image, { type StaticImageData } from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import battleEn from "@/assets/battleship/battle-en.webp";
import battleRu from "@/assets/battleship/battle-ru.webp";
import leaderboardEn from "@/assets/battleship/leaderboard-en.webp";
import leaderboardRu from "@/assets/battleship/leaderboard-ru.webp";
import placementEn from "@/assets/battleship/placement-en.webp";
import placementRu from "@/assets/battleship/placement-ru.webp";
import profileEn from "@/assets/battleship/profile-en.webp";
import profileRu from "@/assets/battleship/profile-ru.webp";
import { WhenNear } from "@/components/when-near";

type Shot = "battle" | "placement" | "leaderboard" | "profile";
type Rule = { cell: string; term: string; text: string };

// 2x captures of the game in each language (tools/quality/capture-battleship.mjs).
const shots: Record<"en" | "ru", Record<Shot, StaticImageData>> = {
  en: {
    battle: battleEn,
    placement: placementEn,
    leaderboard: leaderboardEn,
    profile: profileEn,
  },
  ru: {
    battle: battleRu,
    placement: placementRu,
    leaderboard: leaderboardRu,
    profile: profileRu,
  },
};

const GAME = "https://battleship.outegro.dev";

/** The way into the game, on both pages of the report. */
async function PlayButton({ className }: { className?: string }) {
  const t = await getTranslations("projects");
  return (
    <Button asChild size="sm" className={className}>
      <a href={GAME}>
        {t("play")}
        <ArrowUpRightIcon aria-hidden="true" />
      </a>
    </Button>
  );
}

/**
 * The live product as a magazine report over a spread of the issue. The
 * left page: what it is, the way in, and how it works as the rules of the
 * game, each marked with a cell of the board; ProjectScreens is the right
 * page.
 */
export async function ProjectStory() {
  const t = await getTranslations("projects");
  const rules = t.raw("rules") as Rule[];
  return (
    <div className="story">
      <h2 id="projects-title" className="story-title">
        {t("title")} <span className="story-accent">{t("titleAccent")}</span>
      </h2>
      <div className="story-head">
        <h3 id="project-name" className="story-name">
          {t("name")}
        </h3>
        <PlayButton className="story-play" />
      </div>
      <p className="story-summary">{t("summary")}</p>
      <h4 className="story-rules-title">{t("rulesTitle")}</h4>
      <ol className="story-rules">
        {rules.map((rule) => (
          <li key={rule.cell}>
            <span className="story-cell" aria-hidden="true">
              {rule.cell}
            </span>
            <p>
              <b>{rule.term}.</b> {rule.text}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The right page of the report: the game itself, one large screen and three
 * smaller ones, each with a short caption under it, then what it runs on
 * and the way in again. Printed in ink on the paper; colour comes back
 * under the pointer.
 */
export async function ProjectScreens() {
  const t = await getTranslations("projects");
  const set = shots[(await getLocale()) === "ru" ? "ru" : "en"];
  const stack = t.raw("stack") as string[];
  // half a screen ahead: on a tablet the first layout has them under two
  // screens down
  const screen = (key: Shot, sizes: string) => (
    <figure className="screens-shot">
      <WhenNear
        className="screens-frame"
        ahead="50% 0px"
        label={t(`shots.${key}.alt`)}
      >
        <Image
          src={set[key]}
          alt={t(`shots.${key}.alt`)}
          sizes={sizes}
          placeholder="empty"
        />
      </WhenNear>
      <figcaption>{t(`shots.${key}.caption`)}</figcaption>
    </figure>
  );
  return (
    <div className="screens">
      <div className="screens-main">
        {screen("battle", "(max-width: 767px) 90vw, 40vw")}
      </div>
      <ul className="screens-row">
        {(["placement", "leaderboard", "profile"] as const).map((key) => (
          <li key={key}>{screen(key, "(max-width: 767px) 30vw, 14vw")}</li>
        ))}
      </ul>
      <h4 className="story-label">{t("stackTitle")}</h4>
      <ul className="badge-list">
        {stack.map((tech) => (
          <li key={tech}>
            <Badge>{tech}</Badge>
          </li>
        ))}
      </ul>
      <PlayButton className="screens-play" />
      <p className="screens-note">{t("note")}</p>
    </div>
  );
}
