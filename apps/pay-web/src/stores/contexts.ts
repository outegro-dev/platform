"use client";

import { createContext, useContext } from "react";
import type { OrderWatchStore } from "./order-watch-store";
import type { SubscriptionStore } from "./subscription-store";

/*
 * Stores reach components through context; each screen creates its store
 * once (useState initializer) and provides it to its observers.
 */

export const OrderWatchContext = createContext<OrderWatchStore | null>(null);
export const SubscriptionContext = createContext<SubscriptionStore | null>(
  null,
);

export function useOrderWatch() {
  const store = useContext(OrderWatchContext);
  if (!store) throw new Error("OrderWatchContext is missing");
  return store;
}

export function useSubscription() {
  const store = useContext(SubscriptionContext);
  if (!store) throw new Error("SubscriptionContext is missing");
  return store;
}
