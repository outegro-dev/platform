import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RoomScreen } from "@/components/room/room-screen";
import { normalizeRoomCode } from "@/game/stores/lobby-store";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("room");
  return { title: t("title") };
}

/** Invite link of a private room: /room/K7M2QX. */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = await params;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A broken escape is just an invalid code.
  }
  const code = normalizeRoomCode(decoded).slice(0, 12);
  return (
    <main id="main" className="app-main og-container">
      <RoomScreen
        code={code}
        shareUrl={new URL(
          `/room/${encodeURIComponent(code)}`,
          env.APP_URL,
        ).toString()}
      />
    </main>
  );
}
