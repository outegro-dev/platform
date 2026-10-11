import { generator, seed } from "./random";

/** A shop barcode whose bars come from the text, so every code is its own. */
export function Barcode({ code }: { code: string }) {
  const next = generator(seed(code));
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  while (x < 96) {
    const w = 1 + Math.floor(next() * 3);
    if (next() > 0.38) bars.push({ x, w });
    x += w + 1;
  }
  return (
    <span className="barcode" aria-hidden="true">
      <svg viewBox="0 0 100 34" preserveAspectRatio="none">
        <title>{code}</title>
        {bars.map((bar) => (
          <rect key={bar.x} x={bar.x} y="0" width={bar.w} height="34" />
        ))}
      </svg>
      <span>{code}</span>
    </span>
  );
}

/** A news ticker: the list twice in a row, scrolling on its own. */
export function Ticker({ label, items }: { label: string; items: string[] }) {
  const run = (hidden: boolean) => (
    <ul className="ticker-run" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
  return (
    <section className="ticker" aria-label={label}>
      <p className="ticker-label">{label}</p>
      <div className="ticker-track">
        {run(false)}
        {run(true)}
      </div>
    </section>
  );
}

/** An old pricing-gun label: red rules, felt-tip price, a notch on top. */
export function PriceTag({
  price,
  was,
  note,
  children,
  className,
}: {
  price: string;
  was?: string;
  note?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`price-tag ${className ?? ""}`}>
      {was && <s className="price-was">{was}</s>}
      <p className="price-value">{price}</p>
      {note && <p className="price-note">{note}</p>}
      {children}
      <span className="price-curl" aria-hidden="true">
        ↶
      </span>
    </div>
  );
}

/** A rubber-stamp mark; `Stamped` animates the stamp coming down. */
export function StampMark({
  text,
  tone = "red",
}: {
  text: string;
  tone?: "red" | "blue";
}) {
  return <span className={`stamp-mark is-${tone}`}>{text}</span>;
}
