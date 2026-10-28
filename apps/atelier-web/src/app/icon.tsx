import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * Atelier's mark, a needle with its thread, inked on a square of the zine
 * theme's newsprint (--paper, --ink and --spot-red for the thread: an
 * image takes literal colours).
 */
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#efe4c6",
        border: "4px solid #1b1915",
        borderRadius: 6,
      }}
    >
      <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M7 25 23.5 8.5"
          stroke="#1b1915"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <ellipse
          cx="24.6"
          cy="7.4"
          rx="2.6"
          ry="1.4"
          transform="rotate(-45 24.6 7.4)"
          fill="none"
          stroke="#1b1915"
          strokeWidth="1.8"
        />
        <path
          d="M25 7c3 4-1 9-6 10s-9 4-10 9"
          fill="none"
          stroke="#cf3528"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </div>,
    size,
  );
}
