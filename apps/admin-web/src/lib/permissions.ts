import {
  type Permission as ContractPermission,
  permissions,
} from "@outegro/contracts";
import { type NavKey, navHref } from "./nav";

/**
 * Permissions the console understands. `grants.assign` (manual commercial
 * grants) arrives with payments-backend; until the shared contract lists it,
 * it is handled as a plain string that only an owner token will carry.
 */
export type Permission = ContractPermission | "grants.assign";

/** Anything in the platform permission list opens the console; roles grant them. */
export const consolePermissions: readonly Permission[] = [
  ...permissions,
  "grants.assign",
];

export type Granted = ReadonlySet<string> | readonly string[];

const asSet = (granted: Granted): ReadonlySet<string> =>
  granted instanceof Set ? granted : new Set(granted as readonly string[]);

export function can(granted: Granted, permission: Permission): boolean {
  return asSet(granted).has(permission);
}

export function canAny(granted: Granted, list: readonly Permission[]): boolean {
  const set = asSet(granted);
  return list.some((permission) => set.has(permission));
}

/** A signed-in user without a single admin permission sees "no access". */
export function hasConsoleAccess(granted: Granted): boolean {
  return canAny(granted, consolePermissions);
}

export type NavSectionKey = "overview" | "people" | "services" | "governance";
export type NavItem = {
  key: NavKey;
  href: string;
  /** Shown when the operator holds at least one of these. */
  anyOf: readonly Permission[];
};
export type NavSection = { key: NavSectionKey; items: readonly NavItem[] };

const item = (key: NavKey, anyOf: readonly Permission[]): NavItem => ({
  key,
  href: navHref[key],
  anyOf,
});

export const navigation: readonly NavSection[] = [
  { key: "overview", items: [item("dashboard", consolePermissions)] },
  { key: "people", items: [item("users", ["users.read"])] },
  {
    key: "services",
    items: [
      item("notifications", ["notifications.read"]),
      item("payments", ["billing.read"]),
      item("battleship", ["battleship.read"]),
    ],
  },
  { key: "governance", items: [item("audit", ["audit.read"])] },
];

/** The sidebar for this operator: permitted items only, empty groups dropped. */
export function navigationFor(granted: Granted): NavSection[] {
  const set = asSet(granted);
  return navigation
    .map((section) => ({
      ...section,
      items: section.items.filter((entry) => canAny(set, entry.anyOf)),
    }))
    .filter((section) => section.items.length > 0);
}

/** Tabs of a section page, each with the permission its API needs. */
export type SubNavItem = { key: string; href: string; permission: Permission };

export const sectionTabs = {
  notifications: [
    {
      key: "overview",
      href: "/notifications",
      permission: "notifications.read",
    },
    {
      key: "deliveries",
      href: "/notifications/deliveries",
      permission: "notifications.read",
    },
    {
      key: "templates",
      href: "/notifications/templates",
      permission: "notifications.read",
    },
    {
      key: "channels",
      href: "/notifications/channels",
      permission: "notifications.read",
    },
    { key: "audit", href: "/notifications/audit", permission: "audit.read" },
  ],
  payments: [
    { key: "overview", href: "/payments", permission: "billing.read" },
    { key: "orders", href: "/payments/orders", permission: "billing.read" },
    {
      key: "subscriptions",
      href: "/payments/subscriptions",
      permission: "billing.read",
    },
    { key: "events", href: "/payments/events", permission: "billing.read" },
    { key: "grants", href: "/payments/grants", permission: "billing.read" },
    { key: "issues", href: "/payments/issues", permission: "billing.read" },
    { key: "refunds", href: "/payments/refunds", permission: "billing.read" },
  ],
  battleship: [
    { key: "overview", href: "/battleship", permission: "battleship.read" },
    {
      key: "matches",
      href: "/battleship/matches",
      permission: "battleship.read",
    },
    {
      key: "players",
      href: "/battleship/players",
      permission: "battleship.read",
    },
    { key: "audit", href: "/battleship/audit", permission: "battleship.read" },
  ],
} as const satisfies Record<string, readonly SubNavItem[]>;

export function tabsFor(
  granted: Granted,
  tabs: readonly SubNavItem[],
): SubNavItem[] {
  const set = asSet(granted);
  return tabs.filter((tab) => set.has(tab.permission));
}

/** Tabs of the user card and the permission each one needs. */
export const userTabs = [
  { key: "profile", permission: "users.read" },
  { key: "sessions", permission: "users.read" },
  { key: "roles", permission: "users.read" },
  { key: "access", permission: "users.read" },
  { key: "notifications", permission: "notifications.read" },
  { key: "battleship", permission: "battleship.read" },
  { key: "payments", permission: "billing.read" },
  { key: "activity", permission: "audit.read" },
] as const satisfies readonly { key: string; permission: Permission }[];
export type UserTab = (typeof userTabs)[number]["key"];

export function userTabsFor(granted: Granted): UserTab[] {
  const set = asSet(granted);
  return userTabs
    .filter((tab) => set.has(tab.permission))
    .map((tab) => tab.key);
}
