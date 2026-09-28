import { ImageResponse } from "next/og";
export const size = { width: 64, height: 64 };
export const contentType = "image/png";
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
        fontSize: 30,
        fontWeight: 700,
        letterSpacing: -4,
        borderRadius: 16,
      }}
    >
      NL
    </div>,
    size,
  );
}
