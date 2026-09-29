import { permissionsOf, platformRoles } from "@outegro/contracts";
import { describe, expect, it } from "vitest";
import { activeNav, externalNav } from "./nav";
import {
  can,
  hasConsoleAccess,
  navigationFor,
  sectionTabs,
  tabsFor,
  userTabsFor,
} from "./permissions";

const itemsOf = (granted: Iterable<string>) =>
  navigationFor([...granted]).flatMap((section) =>
    section.items.map((item) => item.key),
  );

describe("navigation by permission", () => {
  it("shows an owner every section", () => {
    const owner = [...permissionsOf(["owner"]), "grants.assign"];
    expect(itemsOf(owner)).toEqual([
      "dashboard",
      "users",
      "notifications",
      "payments",
      "battleship",
      "audit",
      "monitoring",
    ]);
  });

  it("shows support only what support can read", () => {
    expect(itemsOf(permissionsOf(["support"]))).toEqual([
      "dashboard",
      "users",
      "notifications",
      "battleship",
    ]);
  });

  it("gives billing and auditors their sections", () => {
    expect(itemsOf(permissionsOf(["billing_operator"]))).toEqual([
      "dashboard",
      "payments",
    ]);
    expect(itemsOf(permissionsOf(["auditor"]))).toEqual([
      "dashboard",
      "payments",
      "audit",
      "monitoring",
    ]);
  });

  it("drops empty groups", () => {
    const groups = navigationFor([...permissionsOf(["service_operator"])]);
    expect(groups.map((group) => group.key)).toEqual([
      "overview",
      "infrastructure",
    ]);
  });

  it("shows monitoring to monitoring.read only, as a link to Grafana", () => {
    expect(itemsOf(["monitoring.read"])).toEqual(["dashboard", "monitoring"]);
    expect(itemsOf(permissionsOf(["support"]))).not.toContain("monitoring");
    const monitoring = navigationFor(["monitoring.read"])
      .flatMap((section) => section.items)
      .find((item) => item.key === "monitoring");
    expect(monitoring?.href).toBe("/grafana/");
    expect(externalNav.has("monitoring")).toBe(true);
  });

  it("denies the console to a user without admin permissions", () => {
    expect(hasConsoleAccess([])).toBe(false);
    expect(hasConsoleAccess(["something.else"])).toBe(false);
    expect(itemsOf([])).toEqual([]);
    for (const role of Object.keys(platformRoles))
      expect(hasConsoleAccess([...permissionsOf([role])])).toBe(true);
  });

  it("filters section tabs and user card tabs", () => {
    const support = permissionsOf(["support"]);
    expect(
      tabsFor(support, sectionTabs.notifications).map((tab) => tab.key),
    ).toEqual(["overview", "deliveries", "templates", "channels"]);
    expect(userTabsFor(support)).toEqual([
      "profile",
      "sessions",
      "roles",
      "access",
      "notifications",
      "battleship",
    ]);
    expect(can(support, "users.suspend")).toBe(false);
    expect(can(support, "sessions.revoke")).toBe(true);
  });

  it("marks the current section from the path", () => {
    expect(activeNav("/")).toBe("dashboard");
    expect(activeNav("/users/5b449591")).toBe("users");
    expect(activeNav("/payments/orders/1")).toBe("payments");
    expect(activeNav("/unknown")).toBe("dashboard");
    // Grafana is another app: the console never marks it as current.
    expect(activeNav("/grafana/d/abc")).toBe("dashboard");
  });
});
