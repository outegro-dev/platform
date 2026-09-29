import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Same tile as the other platform icons, with the platform's initial. */
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#171817",
        color: "#f2f2ef",
        fontSize: 40,
        fontWeight: 700,
        borderRadius: 16,
        paddingBottom: 6,
      }}
    >
      o
    </div>,
    size,
  );
}
