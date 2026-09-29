"use client";

import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@outegro/ui/dialog";
import { ListIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ContactDialog } from "./contact-dialog";
import { ContactLinks } from "./contact-links";
import { LocaleSwitcher } from "./locale-switcher";

/** Sections of the main page, in page order. */
export const sections = [
  "projects",
  "platform",
  "services",
  "process",
  "contact",
] as const;
type Section = (typeof sections)[number];

/** Navigation order: the Stack page sits between the sections. */
const nav: ({ key: Section; section: Section } | { key: "stack" })[] = [
  { key: "projects", section: "projects" },
  { key: "platform", section: "platform" },
  { key: "services", section: "services" },
  { key: "process", section: "process" },
  { key: "stack" },
  { key: "contact", section: "contact" },
];

/**
 * Fixed header: transparent over the hero, glass once scrolled, tucked away
 * while reading down and back on the slightest scroll up. It switches tone
 * over dark sections so the glass never turns muddy. On the Stack page the
 * section links lead back to the main page.
 */
export function Header({ page = "home" }: { page?: "home" | "stack" }) {
  const t = useTranslations("nav");
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
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 24);
      if (Math.abs(y - last) > 6) {
        setHidden(y > last && y > 480);
        last = y;
      }
      const probe = 38;
      setDark(
        [
          ...document.querySelectorAll<HTMLElement>("main [data-tone='dark']"),
        ].some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top <= probe && rect.bottom >= probe;
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
            Nick Lukashik
          </a>
          <nav className="desktop-nav og-glass" aria-label={t("sections")}>
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
          <div className="header-actions">
            <LocaleSwitcher className="header-locale" />
            <div className="desktop-contact">
              <ContactDialog variant="primary" compact>
                <ContactLinks compact />
              </ContactDialog>
            </div>
            <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="glass"
                  size="icon"
                  className="mobile-menu-toggle"
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
                <LocaleSwitcher className="mobile-menu-locale" />
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>
    </>
  );
}
