/**
 * The platform's liquid-silver signature as a quiet, static ornament:
 * concentric rings around a brushed-silver drop. Decorative only (hidden
 * from assistive technology); shown on wide screens where there is room.
 */
export function SilverRipple({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="ripple" data-size={size} aria-hidden="true">
      <span className="ripple-ring" />
      <span className="ripple-ring" />
      <span className="ripple-ring" />
      <span className="ripple-drop" />
    </span>
  );
}
