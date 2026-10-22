import type { Icon } from "@phosphor-icons/react";
import {
  AnchorSimpleIcon,
  FileTextIcon,
  FolderOpenIcon,
  FolderSimpleIcon,
  GameControllerIcon,
  NotepadIcon,
  TrashIcon,
  UserCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { menu } from "@/lib/stack";
import { Clock } from "./clock";
import { ScrollBody } from "./scroll-body";
import "./desktop.css";

/** The window's own buttons: there to be seen, not pressed. */
export function Controls() {
  return (
    <span className="xp-controls" aria-hidden="true">
      <span className="is-min" />
      <span className="is-max" />
      <span className="is-close" />
    </span>
  );
}

/**
 * A window of the desktop: the blue title bar (its heading, the program's
 * name after it), maybe a menu, the program's own body and maybe a status
 * bar. Opens as it comes into view, after the ones before it.
 */
function Window({
  app,
  icon: Glyph,
  title,
  suffix,
  menu: entries,
  status,
  order,
  children,
}: {
  app: string;
  icon: Icon;
  title: string;
  suffix?: string;
  menu?: string[];
  status?: React.ReactNode;
  order: number;
  children: React.ReactNode;
}) {
  return (
    <article
      className={`xp-window is-${app}`}
      data-reveal
      style={{ "--reveal-delay": `${order * 90}ms` } as React.CSSProperties}
    >
      <div className="xp-title">
        <Glyph className="xp-title-icon" weight="fill" aria-hidden="true" />
        <h3>
          {title}
          {suffix && <span aria-hidden="true">{suffix}</span>}
        </h3>
        <Controls />
      </div>
      {entries && (
        <div className="xp-menu" aria-hidden="true">
          {entries.map((entry) => (
            <span key={entry}>{entry}</span>
          ))}
        </div>
      )}
      {children}
      {status && <p className="xp-status">{status}</p>}
    </article>
  );
}

/**
 * The desktop's taskbar: start, a button per program open on the desktop
 * (in window order, so a minimised window knows where to go) and the game
 * once it runs, the clock.
 */
export async function Taskbar() {
  const [t, process] = await Promise.all([
    getTranslations("services"),
    getTranslations("process"),
  ]);
  const tasks = [t("desktop.notepad.app"), t("desktop.stack.app")];
  return (
    <div className="xp-taskbar" aria-hidden="true">
      <span className="xp-start">
        <AnchorSimpleIcon weight="bold" />
        {t("desktop.start")}
      </span>
      <span className="xp-tasks">
        {tasks.map((task, i) => (
          <span key={task} className={i === 0 ? "is-active" : undefined}>
            {task}
          </span>
        ))}
        <span className="is-game">
          <GameControllerIcon weight="fill" />
          <span>{process("window")}</span>
        </span>
      </span>
      <span className="xp-tray">
        <Clock />
      </span>
    </div>
  );
}

/**
 * What I can build, as an old desktop one screen tall (the wallpaper and
 * the taskbar are the backdrop's, see Os): shortcuts down the left, the
 * introduction open in a text file and the whole stack open in Explorer,
 * a folder for each part of the work, as on the stack page's menu.
 */
export async function Desktop() {
  const [t, stack] = await Promise.all([
    getTranslations("services"),
    getTranslations("stackPage"),
  ]);
  const list = (key: string) => t.raw(key) as string[];
  const shortcuts: { icon: Icon; label: string; href: string }[] = [
    {
      icon: GameControllerIcon,
      label: t("desktop.icons.battleship"),
      href: "https://battleship.outegro.dev",
    },
    {
      icon: UserCircleIcon,
      label: t("desktop.icons.account"),
      href: "https://id.outegro.dev",
    },
    { icon: FileTextIcon, label: t("desktop.icons.stack"), href: "/stack" },
  ];

  // focusable by script: a reader's focus on the broken issue goes on here
  // once the block has "reloaded" (IssueFlight)
  return (
    <section
      id="services"
      className="desktop"
      aria-labelledby="services-title"
      tabIndex={-1}
    >
      <div className="desktop-area og-container">
        <ul className="desktop-icons">
          {shortcuts.map((item) => {
            const Glyph = item.icon;
            return (
              <li key={item.href}>
                <a className="desktop-icon" href={item.href}>
                  <Glyph weight="duotone" aria-hidden="true" />
                  <span>{item.label}</span>
                </a>
              </li>
            );
          })}
          <li aria-hidden="true">
            <span className="desktop-icon">
              <TrashIcon weight="duotone" />
              <span>{t("desktop.icons.bin")}</span>
            </span>
          </li>
        </ul>

        <div className="desktop-windows">
          {/* the introduction: a text file */}
          <article className="xp-window is-notepad" data-reveal>
            <div className="xp-title">
              <NotepadIcon
                className="xp-title-icon"
                weight="fill"
                aria-hidden="true"
              />
              <span>
                {t("desktop.notepad.file")} — {t("desktop.notepad.app")}
              </span>
              <Controls />
            </div>
            <div className="xp-menu" aria-hidden="true">
              {list("desktop.notepad.menu").map((entry) => (
                <span key={entry}>{entry}</span>
              ))}
            </div>
            <div className="xp-body notepad-text">
              {/* one text node: a space of its own is dropped from the name */}
              <h2 id="services-title">{`${t("title")} ${t("titleAccent")}`}</h2>
              <p>
                {t("intro")}
                <span className="notepad-caret" aria-hidden="true" />
              </p>
            </div>
          </article>

          {/* the stack: Explorer open on it, a folder for each part */}
          <Window
            app="stack"
            icon={FolderOpenIcon}
            title={t("desktop.stack.title")}
            suffix={` — ${t("desktop.stack.app")}`}
            menu={list("desktop.stack.menu")}
            status={
              <a className="xp-link" href="/stack">
                {t("desktop.stack.more")}
              </a>
            }
            order={1}
          >
            <p className="stack-address" aria-hidden="true">
              <span>{t("desktop.stack.address")}</span>
              <span className="xp-input">{t("desktop.stack.path")}</span>
            </p>
            <ScrollBody
              className="xp-body stack-folders"
              label={t("desktop.stack.title")}
            >
              {menu.map((section) => (
                <div key={section.id} className="stack-folder">
                  <h4>
                    <FolderSimpleIcon weight="fill" aria-hidden="true" />
                    {stack(`sections.${section.id}.kind`)}
                  </h4>
                  <ul className="xp-tags">
                    {section.dishes.map((dish) => (
                      <li key={dish.id}>
                        {dish.name ?? stack(`names.${dish.id}`)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </ScrollBody>
          </Window>
        </div>
      </div>
    </section>
  );
}
