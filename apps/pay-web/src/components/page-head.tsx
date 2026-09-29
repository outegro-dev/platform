import type { ReactNode } from "react";

/** `01 ── PURCHASES`, then the grotesque + silver italic title. */
export function PageHead({
  index,
  eyebrow,
  title,
  accent,
  lead,
}: {
  index: string;
  eyebrow: string;
  title: string;
  accent: string;
  lead?: ReactNode;
}) {
  return (
    <header className="page-head">
      <p className="og-eyebrow section-index">
        <span>{index}</span>
        <span className="section-rule" aria-hidden="true" />
        <span>{eyebrow}</span>
      </p>
      <h1 className="page-title">
        {title} <span className="og-accent">{accent}</span>
      </h1>
      {lead ? <p className="page-lead">{lead}</p> : null}
    </header>
  );
}
