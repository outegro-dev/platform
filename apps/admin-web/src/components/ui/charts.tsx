import type { CSSProperties, ReactNode } from "react";

/**
 * Small inline-SVG charts, rendered on the server. The plot stretches to
 * its box (lines keep a constant width); axis labels are HTML so they stay
 * readable at any width. Each chart carries a visually hidden data table.
 */

type Tone = "bad" | "muted" | "ok" | undefined;

export function niceMax(value: number): number {
  if (value <= 4) return Math.max(1, Math.ceil(value));
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((f) => f * magnitude >= value) ?? 10;
  return step * magnitude;
}

const frame = (height: number) =>
  ({ "--plot-height": `${height}px` }) as CSSProperties;

export function DailyBars({
  label,
  days,
  series,
  formatValue = (value) => String(value),
  height = 140,
  labelEvery = 1,
}: {
  label: string;
  days: { day: string; label: string; values: Record<string, number> }[];
  series: { key: string; label: string; tone?: Tone }[];
  formatValue?: (value: number) => string;
  height?: number;
  /** Show every n-th day label, counted back from the last day. */
  labelEvery?: number;
}) {
  // Bars stack from zero: a negative value (a day's net after a refund of
  // an earlier payment) draws nothing; the data table keeps the real one.
  const drawn = (day: (typeof days)[number], key: string) =>
    Math.max(0, day.values[key] ?? 0);
  const totals = days.map((day) =>
    series.reduce((sum, item) => sum + drawn(day, item.key), 0),
  );
  const top = niceMax(Math.max(0, ...totals));
  const width = Math.max(1, days.length) * 10;
  return (
    <figure className="chart">
      <div className="chart-frame" style={frame(height)}>
        <div className="chart-yaxis" aria-hidden="true">
          <span>{formatValue(top)}</span>
          <span>{formatValue(top / 2)}</span>
          <span>{formatValue(0)}</span>
        </div>
        <svg
          viewBox={`0 0 ${width} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {[0, 50, 100].map((y) => (
            <line
              key={y}
              className="chart-grid"
              x1={0}
              x2={width}
              y1={y}
              y2={y}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {days.map((day, index) => {
            let offset = 100;
            return (
              <g key={day.day}>
                {series.map((item) => {
                  const value = drawn(day, item.key);
                  const h = top > 0 ? (value / top) * 100 : 0;
                  offset -= h;
                  return value > 0 ? (
                    <rect
                      key={item.key}
                      className="chart-bar"
                      data-series={item.tone}
                      x={index * 10 + 2.9}
                      width={4.2}
                      y={offset}
                      height={h}
                    />
                  ) : null;
                })}
              </g>
            );
          })}
        </svg>
        <div className="chart-xaxis" aria-hidden="true">
          {days.map((day, index) => (
            <span key={day.day}>
              {(days.length - 1 - index) % labelEvery === 0 ? day.label : ""}
            </span>
          ))}
        </div>
      </div>
      {series.length > 1 && (
        <figcaption className="legend">
          {series.map((item) => (
            <span key={item.key} className="legend-item">
              <span className="swatch" data-series={item.tone} />
              {item.label}
            </span>
          ))}
        </figcaption>
      )}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">{label}</th>
              {series.map((item) => (
                <th key={item.key} scope="col">
                  {item.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.day}>
                <th scope="row">{day.label}</th>
                {series.map((item) => (
                  <td key={item.key}>
                    {formatValue(day.values[item.key] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** A line over time (rating history); oldest point on the left. */
export function LineChart({
  label,
  points,
  height = 140,
  low,
  high,
  start,
  end,
}: {
  label: string;
  points: { key: string; label: string; value: number }[];
  height?: number;
  low?: ReactNode;
  high?: ReactNode;
  start?: ReactNode;
  end?: ReactNode;
}) {
  if (points.length === 0) return null;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const width = Math.max(1, points.length - 1) * 10;
  const y = (value: number) => 92 - ((value - min) / span) * 84;
  const path = points
    .map((point, index) => `${index * 10},${y(point.value).toFixed(2)}`)
    .join(" ");
  return (
    <figure className="chart">
      <div className="chart-frame" style={frame(height)}>
        <div className="chart-yaxis" aria-hidden="true">
          <span>{high ?? max}</span>
          <span />
          <span>{low ?? min}</span>
        </div>
        <svg
          viewBox={`0 0 ${width} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {[8, 50, 92].map((line) => (
            <line
              key={line}
              className="chart-grid"
              x1={0}
              x2={width}
              y1={line}
              y2={line}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {points.length > 1 && (
            <>
              <polygon
                className="chart-area"
                points={`0,100 ${path} ${width},100`}
              />
              <polyline
                className="chart-line"
                points={path}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
        {(start || end) && (
          <div className="chart-xaxis" aria-hidden="true">
            <span style={{ justifyContent: "flex-start" }}>{start}</span>
            <span style={{ justifyContent: "flex-end" }}>{end}</span>
          </div>
        )}
      </div>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {points.map((point) => (
              <tr key={point.key}>
                <th scope="row">{point.label}</th>
                <td>{point.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
