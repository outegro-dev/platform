import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/chrome/app-shell";
import { IdentityDown, NoAccess } from "@/components/ui/states";
import { loadInbox, loadViewer } from "@/lib/api";
import { currentPath } from "@/lib/request";
import { signInHref } from "@/lib/routes";

/**
 * Every page of the app: sign-in is required, and the account needs the
 * `atelier.use` permission (the owner role has it); anyone else gets a
 * polite "no access". Mock mode lets everyone in. The drawer slot holds an
 * application opened from the board, over the board.
 */
export default async function AppLayout({
  children,
  drawer,
}: {
  children: ReactNode;
  drawer: ReactNode;
}) {
  const state = await loadViewer();
  if (state.status === "signed-out") redirect(signInHref(await currentPath()));
  if (state.status === "unknown")
    return <IdentityDown retryHref={await currentPath()} />;
  if (state.status === "no-access") return <NoAccess viewer={state.viewer} />;
  const inbox = await loadInbox();
  const inboxCount =
    inbox.status === "ok"
      ? inbox.data.matches.length + inbox.data.tasks.length
      : null;
  return (
    <AppShell viewer={state.viewer} mock={state.mock} inboxCount={inboxCount}>
      {children}
      {drawer}
    </AppShell>
  );
}
