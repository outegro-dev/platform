"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { ToastStore } from "./toast-store";

/**
 * Console-wide client stores. Components read them through `useStores()`
 * and stay presentational; stores get their dependencies in constructors.
 * Observer components opt out of the React Compiler with "use no memo":
 * the compiler would otherwise cache JSX that reads a mutable store.
 */
export type Stores = { toasts: ToastStore };

const StoresContext = createContext<Stores | null>(null);

export function StoresProvider({ children }: { children: ReactNode }) {
  const [stores] = useState<Stores>(() => ({ toasts: new ToastStore() }));
  return <StoresContext value={stores}>{children}</StoresContext>;
}

export function useStores(): Stores {
  const stores = useContext(StoresContext);
  if (!stores) throw new Error("useStores() outside <StoresProvider>");
  return stores;
}
