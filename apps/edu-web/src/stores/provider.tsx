"use client";

import { MathRandom } from "@outegro/edu-engine";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { saveCard, savePosition, submitAttempt } from "@/app/actions";
import { fetchTransport } from "@/lib/assist/transport";
import {
  browserIsOnline,
  browserStorage,
  newIdempotencyKey,
} from "@/lib/browser";
import { sqlEngine } from "@/lib/sql/engine";
import {
  createReaderStores,
  type ReaderInit,
  type ReaderServices,
  type ReaderStores,
} from "./reader-stores";

/*
 * The reading page's stores reach its islands through one context. The
 * value is created once (useState initializer) and never changes, so the
 * provider re-renders nothing: observer components re-render only for the
 * store fields they read. Observers opt out of the React Compiler with
 * "use no memo" — its caching would hand back JSX read from a store that
 * has changed since.
 */

const ReaderStoresContext = createContext<ReaderStores | null>(null);

function browserServices(): ReaderServices {
  return {
    api: { submitAttempt, saveCard, savePosition },
    storage: browserStorage,
    isOnline: browserIsOnline,
    newKey: newIdempotencyKey,
    random: new MathRandom(),
    // The worker starts on the first run, not here.
    sql: { run: (seed, sql) => sqlEngine().run(seed, sql) },
    assist: fetchTransport(),
    now: () => new Date(),
  };
}

export function ReaderStoresProvider({
  init,
  children,
}: {
  init: ReaderInit;
  children: ReactNode;
}) {
  const [stores] = useState(() => createReaderStores(init, browserServices()));
  // Signed out, the preferred view lives in this browser: read after hydration.
  useEffect(() => {
    stores.explain.restore();
  }, [stores]);
  return <ReaderStoresContext value={stores}>{children}</ReaderStoresContext>;
}

export function useReaderStores(): ReaderStores {
  const stores = useContext(ReaderStoresContext);
  if (!stores)
    throw new Error("useReaderStores() outside <ReaderStoresProvider>");
  return stores;
}

/** The page's stores where there may be none (the contents of a gate). */
export function useOptionalReaderStores(): ReaderStores | null {
  return useContext(ReaderStoresContext);
}

/** An island's own store, created once from the page's stores. */
export function useIslandStore<T>(create: (stores: ReaderStores) => T): T {
  const stores = useReaderStores();
  const [store] = useState(() => create(stores));
  return store;
}
