import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * The platform's initial printed in reverse: newsprint on an ink square
 * with a red edge, the zine theme's --paper, --ink and --spot-red (an image
 * takes literal colours).
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
        color: "#efe4c6",
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
