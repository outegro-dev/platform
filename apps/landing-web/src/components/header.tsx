"use client";

import { AccountMenu, AccountMenuPlaceholder } from "@outegro/ui/account-menu";
import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@outegro/ui/dialog";
import {
  type AccountMenuUser,
  productionPlatformUrls,
} from "@outegro/ui/lib/platform";
import { cn } from "@outegro/ui/lib/utils";
import { ArrowUpRightIcon, ListIcon } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { calendly } from "@/lib/contact";
import { LocaleSwitcher } from "./locale-switcher";

/** Sections of the main page, in page order. */
export const sections = ["projects", "services", "process", "contact"] as const;
type Section = (typeof sections)[number];

/** Navigation order: the Stack page sits between the sections. */
const nav: ({ key: Section; section: Section } | { key: "stack" })[] = [
  { key: "projects", section: "projects" },
  { key: "services", section: "services" },
  { key: "process", section: "process" },
  { key: "stack" },
  { key: "contact", section: "contact" },
];

/**
 * Who is signed in, as the site's own /api/account says once the page has
 * loaded: the HTML is the same for every visitor, so it never carries an
 * account. Undefined while asking; "off" while the site has no accounts
 * (SSO off: the page says so up front, or the route answers 404), and then
 * there is no account control at all; null for nobody, and also when the
 * account service cannot answer (the site then simply offers to sign in).
 */
type Visitor =
  | { user: AccountMenuUser | null; home: string }
  | "off"
  | undefined;

function useVisitor(accounts: boolean): Visitor {
  const [visitor, setVisitor] = useState<Visitor>(accounts ? undefined : "off");
  useEffect(() => {
    if (!accounts) return;
    const controller = new AbortController();
    const settle = (user: AccountMenuUser | null) =>
      setVisitor({ user, home: new URL("/", window.location.href).href });
    fetch("/api/account", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (response.status === 404) {
          setVisitor("off");
          return undefined;
        }
        return response.ok
          ? (response.json() as Promise<unknown>).then((data) =>
              settle(data && typeof data === "object" ? data : null),
            )
          : settle(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) settle(null);
      });
    return () => controller.abort();
  }, [accounts]);
  return visitor;
}

/** Where the strip is probed for a dark section under it: its middle. */
const PROBE = 38;

/**
 * Fixed header: transparent over the cover, a strip of the masthead once
 * scrolled, tucked away while reading down and back on the slightest scroll
 * up. It takes the tone of the section under it: over a dark one the strip
 * turns ink and its lettering paper, so the name and the language switch
 * stay legible. On the right: the language, the platform account (the same
 * menu as on every outegro.dev app; none while the site has no accounts)
 * and the call to book, the page's main action. On the Stack page the
 * section links lead back to the main page.
 *
 * The section strip is centred across the bar, and next to the account and
 * the call it only fits from 2xl (1536px): below that it folds into the
 * menu (the `!` utilities win over the layout rules in globals.css). Phones
 * keep the bar to the avatar: signing in and booking are in the menu there.
 */
export function Header({
  page = "home",
  accounts = true,
}: {
  page?: "home" | "stack";
  /** Whether the site has accounts (SSO on); without them, no account control. */
  accounts?: boolean;
}) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const visitor = useVisitor(accounts);
  const known = visitor === "off" ? undefined : visitor;
  const bookHint = useId();
  const home = page === "home";
  const [active, setActive] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [dark, setDark] = useState(false);
  const destination = useRef<string | null>(null);

  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const darkSections = [
      ...document.querySelectorAll<HTMLElement>("main [data-tone='dark']"),
    ];
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 24);
      if (Math.abs(y - last) > 6) {
        setHidden(y > last && y > 480);
        last = y;
      }
      setDark(
        darkSections.some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top <= PROBE && rect.bottom >= PROBE;
        }),
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: "-35% 0px -55% 0px" },
    );
    if (home) {
      for (const id of ["top", ...sections]) {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      }
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [home]);

  const links = nav.map((item) => {
    const section = "section" in item ? item.section : null;
    const current = section ? home && active === section : page === item.key;
    return {
      key: item.key,
      section,
      href: section ? `${home ? "" : "/"}#${section}` : "/stack",
      current,
      // A section in view is a location; the page you are on is the page.
      ariaCurrent: current ? (section ? "location" : "page") : undefined,
    } as const;
  });

  // Signing in is quiet next to the call: the page is there to book one.
  const account = (className?: string) => (
    <AccountMenu
      user={known?.user ?? null}
      current="site"
      urls={productionPlatformUrls}
      locale={locale}
      signInHref={`/auth/sign-in?returnTo=${encodeURIComponent(pathname || "/")}`}
      signOut="/auth/sign-out"
      returnTo={known?.home}
      compact
      className={cn(!known?.user && "bg-secondary text-foreground", className)}
    />
  );

  return (
    <>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <header
        className="site-header"
        data-scrolled={scrolled || undefined}
        data-hidden={(hidden && !menuOpen) || undefined}
        data-tone={dark ? "dark" : undefined}
        onFocusCapture={() => setHidden(false)}
      >
        <div className="site-header-inner og-container">
          <a
            href={home ? "#top" : "/"}
            className="wordmark"
            aria-label={home ? t("home") : t("homePage")}
          >
            {/* on the main page the name signs the magazine: "by" the author */}
            {home && <span className="wordmark-by">{t("by")}</span>}
            Nick Lukashik
          </a>
          {/* on the main page a rule runs from the byline, as on a masthead */}
          {home && <span className="header-rule" aria-hidden="true" />}
          {/* at the top of the main page: two links, as on a masthead; the
              section strip and the menu take over once the page scrolls */}
          {home && (
            <nav className="masthead-nav" aria-label={t("sections")}>
              <a href="#projects">{t("projects")}</a>
              <a href="#process">{t("process")}</a>
            </nav>
          )}
          {/* elsewhere the strip of every section; the main page has its
              masthead links instead */}
          {!home && (
            <nav
              className="desktop-nav og-glass max-2xl:hidden!"
              aria-label={t("sections")}
            >
              {links.map((link) => (
                <a
                  key={link.key}
                  className={link.current ? "is-active" : undefined}
                  aria-current={link.ariaCurrent}
                  href={link.href}
                >
                  {t(link.key)}
                </a>
              ))}
            </nav>
          )}
          <div className="header-actions">
            <LocaleSwitcher className="header-locale" />
            {visitor === "off" ? null : visitor === undefined ? (
              <AccountMenuPlaceholder
                compact
                className="header-account max-md:hidden"
              />
            ) : (
              account(
                visitor.user
                  ? "header-account"
                  : "header-account max-md:hidden",
              )
            )}
            {home && <span className="header-divider" aria-hidden="true" />}
            {/* The short label where the bar is narrow or shared with the
                section strip; the accessible name is the visible one. */}
            <Button asChild size="sm" className="header-book max-md:hidden">
              <a
                href={calendly}
                target="_blank"
                rel="noopener noreferrer"
                aria-describedby={bookHint}
              >
                <span className="max-lg:hidden 2xl:hidden">{t("book")}</span>
                <span className="lg:max-2xl:hidden">{t("bookShort")}</span>
                {home && <span className="book-talk">{t("talk")}</span>}
                <ArrowUpRightIcon aria-hidden="true" />
              </a>
            </Button>
            <span id={bookHint} hidden>
              {t("bookHint")}
            </span>
            <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="glass"
                  size="icon"
                  // the main page needs the menu only where its masthead
                  // links are folded away
                  className={cn(
                    "mobile-menu-toggle",
                    home ? "max-lg:inline-flex!" : "max-2xl:inline-flex!",
                  )}
                  aria-label={t("menu")}
                >
                  <ListIcon />
                </Button>
              </DialogTrigger>
              <DialogContent
                closeLabel={t("close")}
                className="mobile-menu"
                onCloseAutoFocus={(event) => {
                  if (!destination.current) return;
                  event.preventDefault();
                  const target = document.getElementById(destination.current);
                  destination.current = null;
                  requestAnimationFrame(() => {
                    target?.setAttribute("tabindex", "-1");
                    target?.focus({ preventScroll: true });
                    target?.scrollIntoView({
                      behavior: matchMedia("(prefers-reduced-motion: reduce)")
                        .matches
                        ? "instant"
                        : "smooth",
                    });
                  });
                }}
              >
                <DialogTitle className="sr-only">{t("sections")}</DialogTitle>
                <DialogDescription className="sr-only">
                  Nick Lukashik
                </DialogDescription>
                <nav aria-label={t("sections")}>
                  {links.map((link, i) => (
                    <a
                      href={link.href}
                      key={link.key}
                      aria-current={link.ariaCurrent}
                      onClick={() => {
                        // In-page jumps restore focus to the section; links to
                        // another page just navigate.
                        destination.current =
                          home && link.section ? link.section : null;
                        setMenuOpen(false);
                      }}
                    >
                      <span className="og-eyebrow">0{i + 1}</span>
                      {t(link.key)}
                    </a>
                  ))}
                </nav>
                <div className="mt-8 flex flex-wrap items-center gap-4 md:hidden">
                  <Button asChild size="lg">
                    <a
                      href={calendly}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-describedby={bookHint}
                      onClick={() => setMenuOpen(false)}
                    >
                      {t("book")}
                      <ArrowUpRightIcon aria-hidden="true" />
                    </a>
                  </Button>
                  {known && !known.user ? account() : null}
                </div>
                <LocaleSwitcher className="mobile-menu-locale" />
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>
    </>
  );
}
