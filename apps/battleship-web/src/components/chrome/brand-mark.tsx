/** The game's mark: a small hull on a waterline (decorative). */
export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        d="M5 17.5h19.2c1.6 0 2.9.9 3.4 2.2l.4 1.3H7.6c-1.2 0-2.2-.7-2.6-1.8Z"
        fill="currentColor"
      />
      <rect x="11" y="12.5" width="7" height="4" rx="1.4" fill="currentColor" />
      <path
        d="M20.5 16.5h3.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M3 25c2.2 0 2.2-1.4 4.4-1.4S9.6 25 11.8 25s2.2-1.4 4.4-1.4S18.4 25 20.6 25s2.2-1.4 4.4-1.4S27.2 25 29 25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
