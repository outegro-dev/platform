import { cn } from "@outegro/ui/lib/utils";

/** Stable keys for a number of identical placeholders. */
const slots = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

/**
 * Placeholders with the size of what replaces them, so streamed content
 * lands in place. They are hidden from assistive technology; the region
 * reports itself busy instead.
 */
export function Skeleton({
  width = "100%",
  height = 14,
  className,
  radius,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
  radius?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("skeleton", className)}
      style={{ width, height, borderRadius: radius }}
    />
  );
}

export function PanelSkeleton({
  className,
  label,
  stats = 4,
  rows = 4,
  chart = false,
}: {
  className?: string;
  label: string;
  stats?: number;
  rows?: number;
  chart?: boolean;
}) {
  return (
    <section
      className={cn("panel", className)}
      aria-busy="true"
      aria-label={label}
    >
      <div className="panel-heading">
        <Skeleton width={90} height={11} />
        <Skeleton width={180} height={18} />
      </div>
      {stats > 0 && (
        <div className="stats">
          {slots(stats, "stat").map((key) => (
            <div key={key} className="stat">
              <Skeleton width="60%" height={12} />
              <Skeleton width="45%" height={30} />
            </div>
          ))}
        </div>
      )}
      {chart && <Skeleton height={168} />}
      {rows > 0 && (
        <div className="stack-sm">
          {slots(rows, "row").map((key, index) => (
            <Skeleton key={key} height={16} width={`${92 - index * 9}%`} />
          ))}
        </div>
      )}
    </section>
  );
}

export function TableSkeleton({
  label,
  rows = 8,
  withFilters = true,
}: {
  label: string;
  rows?: number;
  withFilters?: boolean;
}) {
  return (
    <section
      className="panel"
      data-flush=""
      aria-busy="true"
      aria-label={label}
    >
      <div className="panel-head">
        <div className="panel-heading">
          <Skeleton width={160} height={18} />
        </div>
      </div>
      {withFilters && (
        <div className="filters">
          {slots(3, "field").map((key) => (
            <div key={key} className="field">
              <Skeleton width={80} height={12} />
              <Skeleton height={48} radius={12} />
            </div>
          ))}
        </div>
      )}
      <div
        className="stack-sm"
        style={{ padding: "12px clamp(18px, 2vw, 26px) 24px" }}
      >
        {slots(rows, "line").map((key) => (
          <Skeleton key={key} height={46} radius={10} />
        ))}
      </div>
    </section>
  );
}
