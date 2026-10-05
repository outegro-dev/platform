"use client";

import { useEffect } from "react";
import { useReaderStores } from "@/stores/provider";

/** The reading line, % of the screen from the top: a section is "in view" once its heading is above it. */
const READING_LINE = 30;
/** The band watched just above the line, % of the screen. */
const BAND = 10;

/**
 * Follows which section of the chapter the reader is in, for the contents
 * (aria-current="location"). An IntersectionObserver watches the blocks of
 * the text crossing a band just above the reading line, so a scroll, a
 * jump to an anchor or a resize all report it; the section is then the
 * last heading above the line. Reads only, never writes the layout.
 */
export function SectionSpy({ ids }: { ids: readonly string[] }) {
  const { sections } = useReaderStores();
  const key = ids.join("\n");

  useEffect(() => {
    const headings = key
      .split("\n")
      .map((id) => (id ? document.getElementById(id) : null))
      .filter((node): node is HTMLElement => node !== null);
    const first = headings[0];
    if (!first) return;
    const text = first.parentElement;
    const watched = text ? Array.from(text.children) : headings;
    let frame = 0;
    const pick = () => {
      frame = 0;
      const line = (window.innerHeight * READING_LINE) / 100;
      let current: string | null = null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > line) break;
        current = heading.id;
      }
      sections.show(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(pick);
    };
    const observer = new IntersectionObserver(schedule, {
      rootMargin: `-${READING_LINE - BAND}% 0px -${100 - READING_LINE}% 0px`,
    });
    for (const node of watched) observer.observe(node);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [key, sections]);

  return null;
}
