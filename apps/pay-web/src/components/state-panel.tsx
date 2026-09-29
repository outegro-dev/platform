import type { ReactNode } from "react";
import { SilverRipple } from "./silver-ripple";

/**
 * Empty, unavailable or out-of-date: always a heading, an explanation and
 * a way forward, so a failure never looks like "nothing here".
 */
export function StatePanel({
  tone,
  icon,
  title,
  body,
  actions,
  role,
}: {
  tone?: "danger";
  icon: ReactNode;
  title: string;
  body: string;
  actions?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <section className="card state-panel" data-tone={tone} role={role}>
      <SilverRipple />
      <span className="state-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {actions ? <div className="state-actions">{actions}</div> : null}
    </section>
  );
}
