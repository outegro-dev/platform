"use client";

import type { PlayerProfile } from "@outegro/contracts/battleship";
import { observer } from "mobx-react-lite";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { SoundEngine } from "@/game/sound/sound-engine";
import type { KeyValueStorage } from "@/game/stores/preferences-store";
import { RootStore } from "@/game/stores/root-store";
import { sessionPendingPurchases } from "@/game/stores/shop-store";
import {
  browserEnvironment,
  type SocketLike,
  staticEnvironment,
} from "@/game/transport/game-socket";
import { fetchTicket } from "@/game/transport/tickets";
import { profileSource, shopApi, statsApi } from "@/lib/client-api";

const RootContext = createContext<RootStore | null>(null);

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Creates this tab's RootStore once (also during the server render, where
 * it never connects) and keeps it in sync with the server's view of the
 * session. The socket starts only in the browser, only when signed in.
 */
export function RootStoreProvider({
  signedIn,
  profile,
  socketUrl,
  children,
}: {
  signedIn: boolean;
  profile: PlayerProfile | null;
  socketUrl: string;
  children: ReactNode;
}) {
  const [root] = useState(() => {
    const browser = typeof window !== "undefined";
    return new RootStore({
      signedIn,
      profile,
      socketUrl,
      tickets: () => fetchTicket(),
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      profileSource,
      shopApi,
      statsApi,
      navigate: (url) => window.location.assign(url),
      environment: browser ? browserEnvironment() : staticEnvironment,
      storage: browser ? browserStorage() : null,
      pendingPurchases: browser ? sessionPendingPurchases() : null,
      createSound: (preferences) => new SoundEngine(() => preferences.sound),
    });
  });

  useEffect(() => {
    root.start();
    return () => root.dispose();
  }, [root]);

  useEffect(() => {
    root.setSession(signedIn, profile);
  }, [root, signedIn, profile]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => root.preferences.setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [root]);

  return <RootContext.Provider value={root}>{children}</RootContext.Provider>;
}

export function useRoot(): RootStore {
  const root = useContext(RootContext);
  if (!root) throw new Error("useRoot outside RootStoreProvider");
  return root;
}

/**
 * Follows the player into a match found or started from this tab (queue,
 * bot, room) and into the page of a room they just created.
 */
export const MatchFollower = observer(function MatchFollower() {
  const { lobby } = useRoot();
  const router = useRouter();
  const pathname = usePathname();
  const matches = useRef(lobby.matchRequested);
  const rooms = useRef(lobby.roomOpened);
  const requested = lobby.matchRequested;
  const opened = lobby.roomOpened;
  const code = lobby.room?.code ?? null;

  useEffect(() => {
    if (requested === matches.current) return;
    matches.current = requested;
    if (pathname !== "/play") router.push("/play");
  }, [requested, pathname, router]);

  useEffect(() => {
    if (opened === rooms.current) return;
    rooms.current = opened;
    if (code && pathname !== `/room/${code}`) router.push(`/room/${code}`);
  }, [opened, code, pathname, router]);

  return null;
});
