/**
 * A rubber-stamped postmark: two rings with a star and wavy cancellation
 * lines, a little worn, in postal blue. The paper version of the
 * platform's ripple: a quiet, static ornament, decorative only (hidden
 * from assistive technology) and shown on wide screens where there is room.
 */
export function Postmark({ size = "md" }: { size?: "md" | "lg" }) {
  // Same definition wherever it repeats, so a shared id is harmless.
  const wear = `postmark-wear-${size}`;
  return (
    <span className="postmark" data-size={size} aria-hidden="true">
      <svg viewBox="0 0 320 180" aria-hidden="true" focusable="false">
        <filter id={wear} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves="2"
            seed="7"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.8 1.55"
            result="wear"
          />
          <feComposite in="SourceGraphic" in2="wear" operator="in" />
        </filter>
        <g filter={`url(#${wear})`} fill="none" stroke="currentColor">
          <circle cx="90" cy="90" r="80" strokeWidth="5" />
          <circle
            cx="90"
            cy="90"
            r="70"
            strokeWidth="9"
            strokeDasharray="3 6"
          />
          <circle cx="90" cy="90" r="58" strokeWidth="2.5" />
          <path
            d="M90 62l7.6 15.4 17 2.5-12.3 12 2.9 16.9L90 100.8l-15.2 8 2.9-16.9-12.3-12 17-2.5Z"
            fill="currentColor"
            stroke="none"
          />
          <path
            d="M70 124h40M78 132h24"
            strokeWidth="4"
            strokeLinecap="round"
          />
          {[54, 78, 102, 126].map((y) => (
            <path
              key={y}
              d={`M182 ${y}q9 -7 18 0t18 0t18 0t18 0t18 0t18 0t18 0`}
              strokeWidth="4.5"
              strokeLinecap="round"
            />
          ))}
        </g>
      </svg>
    </span>
  );
}
