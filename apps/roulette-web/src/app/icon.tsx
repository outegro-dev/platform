import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * The game's mark, a wheel of sectors, in newsprint on the zine theme's
 * dark ink (--ink, --paper, --spot-yellow: an image takes literal colours).
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
        background: "#1b1915",
        border: "4px solid #cf3528",
        borderRadius: 6,
      }}
    >
      <svg width="46" height="46" viewBox="0 0 32 32" aria-hidden="true">
        <circle
          cx="16"
          cy="16"
          r="12.5"
          fill="none"
          stroke="#efe4c6"
          strokeWidth="2.4"
        />
        <circle
          cx="16"
          cy="16"
          r="8"
          fill="none"
          stroke="#efe4c6"
          strokeWidth="5"
          strokeDasharray="3.1 2.18"
        />
        <circle cx="16" cy="16" r="2.6" fill="#f5c518" />
      </svg>
    </div>,
    size,
  );
}
