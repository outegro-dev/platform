"use client";

import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@outegro/ui/dialog";
import {
  type AccountMenuUser,
  productionPlatformUrls,
} from "@outegro/ui/lib/platform";
import { ArrowUpRightIcon, ListIcon, XIcon } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { calendly } from "@/lib/contact";
import { LocaleSwitcher } from "./locale-switcher";

/** Sections of the main page, in page order. */
const sections = ["projects", "services", "process", "contact"] as const;

/** The masthead's two links, as on the cover. */
const masthead = ["projects", "process"] as const;

/**
 * The account's room at the end of the bar (zine-page.css; nothing in the
 * menu, where nothing comes after it): held while the account is on its
 * way for someone signed in on the last page here, so the links and the
 * call do not move when it comes.
 */
const accountRoom = <span className="header-account-room" aria-hidden="true" />;

/**
 * The platform account (Radix's dropdown and a dozen icons) shows in the
 * opened menu, or in the bar for someone signed in, once /api/account has
 * answered: it loads then, not with every page, its room held meanwhile.
 */
const AccountMenu = dynamic(
  () => import("@outegro/ui/account-menu").then((mod) => mod.AccountMenu),
  { ssr: false, loading: () => accountRoom },
);

/** localStorage: someone was signed in on the last page here. */
const SIGNED_IN = "og-signed-in";

const signedInBefore = () => {
  try {
    return localStorage.getItem(SIGNED_IN) === "1";
  } catch {
    return false;
  }
};

const noteSignedIn = (signedIn: boolean) => {
  try {
    if (signedIn) localStorage.setItem(SIGNED_IN, "1");
    else localStorage.removeItem(SIGNED_IN);
  } catch {
    // no storage: the account makes its room when it comes
  }
};

/**
 * Who is signed in, as the site's own /api/account says once the page has
 * loaded: the HTML is the same for every visitor, so it never carries an
 * account. Undefined while asking, "returning" while asking after a page
 * someone was signed in on; "off" while the site has no accounts (SSO off:
 * the page says so up front, or the route answers 404), and then there is
 * no account control at all; null for nobody, and also when the account
 * service cannot answer (the site then simply offers to sign in).
 */
type Visitor =
  | { user: AccountMenuUser | null; home: string }
  | "returning"
  | "off"
  | undefined;

function useVisitor(accounts: boolean): Visitor {
  const [visitor, setVisitor] = useState<Visitor>(accounts ? undefined : "off");
  useEffect(() => {
    if (!accounts) return;
    if (signedInBefore()) setVisitor("returning");
    const controller = new AbortController();
    const settle = (user: AccountMenuUser | null) => {
      noteSignedIn(user !== null);
      setVisitor({ user, home: new URL("/", window.location.href).href });
    };
    fetch("/api/account", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (response.status === 404) {
          noteSignedIn(false);
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

/**
 * Fixed header, the masthead of the vintage cover on every page:
 * transparent at the top, on the cover's paper once scrolled, tucked away
 * while reading down and back on the slightest scroll up. The name with a
 * rule, two links (on the other pages they lead back to the main page), the
 * language and the call to talk, the page's main action.
 *
 * The platform account (the same menu as on every outegro.dev app; none
 * while the site has no accounts) shows in the bar only once someone is
 * signed in, at its end: the bar never offers to sign in, the page is there
 * to book a call. Below 1024px the links, the call and the account fold
 * into the menu, which unfolds from the masthead and also offers to sign
 * in: the bar keeps the name, the language and the menu.
 */
export function Header({
  home = false,
  accounts = true,
}: {
  /** The main page: the name signs the cover, the links stay on the page. */
  home?: boolean;
  /** Whether the site has accounts (SSO on); without them, no account control. */
  accounts?: boolean;
}) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const visitor = useVisitor(accounts);
  const known = typeof visitor === "object" ? visitor : undefined;
  const bookHint = useId();
  const menuHint = useId();
  const [active, setActive] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const destination = useRef<string | null>(null);
  const menuLinks = useRef<HTMLElement>(null);

  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 24);
      if (Math.abs(y - last) > 6) {
        setHidden(y > last && y > 480);
        last = y;
      }
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

  const links = masthead.map((section) => ({
    section,
    href: `${home ? "" : "/"}#${section}`,
    // the section in view is where the reader is
    current: home && active === section ? ("location" as const) : undefined,
  }));

  // on the main page the name signs the magazine: "by" the author, an
  // English word on either page. The space opens the name's own text: a
  // space alone between the tags drops out of the link's spoken name
  const name = (
    <>
      {home && (
        <span className="wordmark-by" lang="en">
          {t("by")}
        </span>
      )}
      {home ? " Nick Lukashik" : "Nick Lukashik"}
    </>
  );

  const account = (className: string) =>
    known ? (
      <AccountMenu
        user={known.user}
        current="site"
        urls={productionPlatformUrls}
        locale={locale}
        signInHref={`/auth/sign-in?returnTo=${encodeURIComponent(pathname || "/")}`}
        signOut="/auth/sign-out"
        returnTo={known.home}
        compact
        className={className}
      />
    ) : null;

  return (
    <>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <header
        className="site-header"
        data-scrolled={scrolled || undefined}
        data-hidden={(hidden && !menuOpen) || undefined}
        onFocusCapture={() => setHidden(false)}
      >
        <div className="site-header-inner og-container">
          {/* the name as it reads, then where it leads */}
          <a href={home ? "#top" : "/"} className="wordmark">
            {name}
            <span className="sr-only">, {t(home ? "toTop" : "toHome")}</span>
          </a>
          <span className="header-rule" aria-hidden="true" />
          <nav className="masthead-nav" aria-label={t("sections")}>
            {links.map((link) => (
              <a
                key={link.section}
                href={link.href}
                aria-current={link.current}
              >
                {t(link.section)}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <LocaleSwitcher className="header-locale" />
            <span className="header-divider" aria-hidden="true" />
            <a
              className="header-book"
              href={calendly}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby={bookHint}
            >
              {t("talk")}
              <ArrowUpRightIcon aria-hidden="true" />
            </a>
            <span id={bookHint} hidden>
              {t("bookHint")}
            </span>
            {/* from 1024px, where the menu's square stands below that: who is
                signed in and the way to sign out, only once someone is */}
            {known?.user
              ? account("header-account")
              : visitor === "returning" && accountRoom}
            <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="mobile-menu-toggle"
                  aria-label={t("menu")}
                >
                  <ListIcon aria-hidden="true" />
                </button>
              </DialogTrigger>
              <DialogContent
                showCloseButton={false}
                className="mobile-menu"
                // its top row lies over the bar, as tall as the bar is now
                data-scrolled={scrolled || undefined}
                // Radix wraps Tab round the menu without scrolling it: on a
                // screen shorter than the menu the focused control is
                // brought into view (a tap's focus stays where it is)
                onFocusCapture={(event) => {
                  const { currentTarget: menu, target } = event;
                  if (menu.contains(target) && target.matches(":focus-visible"))
                    target.scrollIntoView({ block: "nearest" });
                }}
                // the first link, not the language (Radix skips links)
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  menuLinks.current?.querySelector("a")?.focus();
                }}
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
                <p className="wordmark mobile-menu-mark" aria-hidden="true">
                  <span>{name}</span>
                </p>
                {/* the top row first, as it reads: the language, then the
                    close (the kit's own close would come last) */}
                <LocaleSwitcher className="mobile-menu-locale" />
                <span
                  className="header-divider mobile-menu-divider"
                  aria-hidden="true"
                />
                <DialogClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mobile-menu-close"
                    aria-label={t("close")}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </DialogClose>
                <nav ref={menuLinks} aria-label={t("sections")}>
                  {links.map((link, i) => (
                    <a
                      href={link.href}
                      key={link.section}
                      aria-current={link.current}
                      onClick={() => {
                        // In-page jumps restore focus to the section; links to
                        // another page just navigate.
                        destination.current = home ? link.section : null;
                        setMenuOpen(false);
                      }}
                    >
                      <span className="mobile-menu-no">0{i + 1}</span>
                      {t(link.section)}
                    </a>
                  ))}
                </nav>
                <a
                  className="mobile-menu-book"
                  href={calendly}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-describedby={menuHint}
                  onClick={() => setMenuOpen(false)}
                >
                  {t("book")}
                  <ArrowUpRightIcon aria-hidden="true" />
                </a>
                <p id={menuHint} className="mobile-menu-hint">
                  {t("bookHint")}
                </p>
                {account("mobile-menu-account")}
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>
    </>
  );
}
