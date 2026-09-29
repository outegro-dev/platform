import type { ReactNode } from "react";

/**
 * Title and lead of an account page. The loading skeleton renders the same
 * head with the same text, so it stays put when the data arrives.
 */
export function PageHead({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      <p>{lead}</p>
      {children}
    </header>
  );
}
