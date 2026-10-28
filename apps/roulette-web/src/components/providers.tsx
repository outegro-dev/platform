"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { type KeyValueStorage, SoundBlips } from "@/game/sound";
import { type Player, RouletteStore } from "@/game/stores/roulette-store";
import {
  browserEnvironment,
  RouletteSocket,
  type SocketLike,
  staticEnvironment,
} from "@/game/transport/roulette-socket";
import { fetchTicket } from "@/game/transport/tickets";

type Services = { store: RouletteStore; sound: SoundBlips };

const ServicesContext = createContext<Services | null>(null);

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The wallet's own figure through the BFF; null when it cannot say. */
async function readWallet(): Promise<number | null> {
  const response = await fetch("/api/wallet", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    balance?: unknown;
  } | null;
  return typeof body?.balance === "number" ? body.balance : null;
}

/**
 * Creates this tab's store and sound once (also during the server render,
 * where they never connect or play). The socket opens only where the game
 * is on screen (`useLiveRound`), so /fair does not pull 4 frames a second.
 */
export function StoreProvider({
  player,
  socketUrl,
  children,
}: {
  player: Player | null;
  socketUrl: string;
  children: ReactNode;
}) {
  const [services] = useState<Services>(() => {
    const browser = typeof window !== "undefined";
    return {
      store: new RouletteStore({
        player,
        readWallet,
        socket: new RouletteSocket({
          url: socketUrl,
          tickets: () => fetchTicket(),
          createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
          environment: browser ? browserEnvironment() : staticEnvironment,
        }),
      }),
      sound: new SoundBlips(browser ? browserStorage() : null),
    };
  });

  // Sound may play only after the player's first click or key on the page.
  useEffect(() => {
    const unlock = () => services.sound.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [services]);

  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  );
}

function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("used outside StoreProvider");
  return services;
}

export function useStore(): RouletteStore {
  return useServices().store;
}

export function useSound(): SoundBlips {
  return useServices().sound;
}

/** Connects the game socket while the calling screen is mounted. */
export function useLiveRound(): RouletteStore {
  const store = useStore();
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return store;
}

/** The visitor's reduced-motion preference: the strip then jumps to the stop. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}
