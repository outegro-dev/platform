import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * The platform's initial inked on a square of the zine theme's newsprint
 * (--paper and --ink: an image takes literal colours).
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
        color: "#1b1915",
        fontSize: 40,
        fontWeight: 700,
        paddingBottom: 6,
      }}
    >
      o
    </div>,
    size,
  );
}
