import type { CSSProperties } from "react";

const hex = /^#[0-9A-Fa-f]{6}$/;

/**
 * A book's accent colour as a CSS custom property. It comes from the
 * book's data and tints its diagrams and interactive parts only; the
 * platform's tokens do the rest. Anything but a plain hex colour is
 * ignored (the platform's foreground stands in).
 */
export function accentStyle(theme: { accent: string }): CSSProperties {
  return (
    hex.test(theme.accent) ? { "--book-accent": theme.accent } : {}
  ) as CSSProperties;
}
