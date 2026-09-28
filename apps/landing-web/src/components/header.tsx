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

export const sections = [
  "expertise",
  "approach",
  "platform",
  "projects",
  "contact",
] as const;

/**
 * Fixed header: transparent over the hero, glass once scrolled, tucked away
 * while reading down and back on the slightest scroll up. It switches tone
 * over dark sections so the glass never turns muddy.
 */
export function Header() {
  const t = useTranslations("nav");
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
    for (const id of ["top", ...sections]) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

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
          <a href="#top" className="wordmark" aria-label={t("home")}>
            Nick Lukashik
          </a>
          <nav className="desktop-nav og-glass" aria-label={t("sections")}>
            {sections.map((section) => (
              <a
                key={section}
                className={active === section ? "is-active" : undefined}
                aria-current={active === section ? "location" : undefined}
                href={`#${section}`}
              >
                {t(section)}
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
                  {sections.map((section, i) => (
                    <a
                      href={`#${section}`}
                      key={section}
                      onClick={() => {
                        destination.current = section;
                        setMenuOpen(false);
                      }}
                    >
                      <span className="og-eyebrow">0{i + 1}</span>
                      {t(section)}
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
