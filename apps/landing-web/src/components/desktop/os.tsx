import {
  GameControllerIcon,
  HourglassMediumIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { PaperJourney } from "@/components/paper/paper-journey";
import { Controls, Desktop, Taskbar } from "./desktop";
import { OsStage } from "./os-stage";
import { Wallpaper } from "./wallpaper";

type Step = { title: string; body: string; see: string };

/**
 * The old computer the page turns into after the broken issue: one
 * wallpaper and taskbar under two acts. First the desktop with what I can
 * build in a text file and the whole stack in Explorer; then, the windows
 * minimised and a loader that runs on its own, the process as a game in a
 * large window: a title screen and the paper cartoon played by scrolling,
 * down to the pier.
 *
 * On wide, tall-enough screens with motion OsStage pins it all to one
 * screen and plays the acts by scroll (the layers stack, the marks carry
 * the #services and #process anchors). Everywhere else the desktop and the
 * game window simply follow one another over the wallpaper.
 */
export async function Os() {
  const t = await getTranslations("process");
  const steps = t.raw("steps") as Step[];
  return (
    <div className="os">
      <div className="os-backdrop" aria-hidden="true">
        <Wallpaper />
        <Taskbar />
      </div>
      <Desktop />
      <div className="os-loading" aria-hidden="true">
        <div className="xp-window os-loader">
          <div className="xp-title">
            <GameControllerIcon className="xp-title-icon" weight="fill" />
            <span>{t("window")}</span>
            <Controls />
          </div>
          <div className="os-loader-body">
            <HourglassMediumIcon className="os-hourglass" weight="duotone" />
            <p className="os-loader-title">{t("loading")}…</p>
            <div className="xp-progress">
              <span />
            </div>
            <p className="os-loader-note">{t("levels")}</p>
          </div>
        </div>
      </div>
      <div className="os-game-layer">
        <section
          id="process"
          className="xp-window os-game"
          aria-labelledby="process-title"
        >
          <div className="xp-title">
            <GameControllerIcon
              className="xp-title-icon"
              weight="fill"
              aria-hidden="true"
            />
            <span>{t("window")}</span>
            <Controls />
          </div>
          <div className="os-game-screen">
            <div className="os-game-intro">
              <p className="os-game-chapter">{t("label")}</p>
              <h2 id="process-title">
                {t("title")} <span>{t("titleAccent")}</span>
              </h2>
              <p>{t("intro")}</p>
              <p className="os-game-start" aria-hidden="true">
                ▶ {t("start")}
              </p>
            </div>
            <PaperJourney
              steps={steps}
              labels={{ youSee: t("youSee") }}
              track=".os-mark.is-process"
            />
          </div>
          <p className="xp-status">{t("ai")}</p>
        </section>
      </div>
      <span className="os-mark is-services" aria-hidden="true" />
      <span className="os-mark is-process" aria-hidden="true" />
      <OsStage />
    </div>
  );
}
