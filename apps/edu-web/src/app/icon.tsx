import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * The books' mark, an open book with a ribbon, inked on a square of the
 * zine theme's newsprint (--paper, --ink and --spot-red for the ribbon: an
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
          d="M16 9.4c-2.6-1.9-6.3-2.6-11-2.3v15.6c4.7-.3 8.4.4 11 2.3 2.6-1.9 6.3-2.6 11-2.3V7.1c-4.7-.3-8.4.4-11 2.3Z"
          fill="none"
          stroke="#1b1915"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M16 9.6v15"
          stroke="#1b1915"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path d="M20.5 7.6v7.2l1.9-1.5 1.9 1.5V7.4" fill="#cf3528" />
      </svg>
    </div>,
    size,
  );
}
