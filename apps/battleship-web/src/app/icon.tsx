import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** The platform tile with the game's mark: a hull on a waterline. */
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
        borderRadius: 16,
      }}
    >
      <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M5 17.5h19.2c1.6 0 2.9.9 3.4 2.2l.4 1.3H7.6c-1.2 0-2.2-.7-2.6-1.8Z"
          fill="#f2f2ef"
        />
        <rect x="11" y="12.5" width="7" height="4" rx="1.4" fill="#f2f2ef" />
        <path
          d="M3 25c2.2 0 2.2-1.4 4.4-1.4S9.6 25 11.8 25s2.2-1.4 4.4-1.4S18.4 25 20.6 25s2.2-1.4 4.4-1.4S27.2 25 29 25"
          fill="none"
          stroke="#f2f2ef"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.6"
        />
      </svg>
    </div>,
    size,
  );
}
