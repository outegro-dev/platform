import { permissionsOf } from "@outegro/contracts";
import { describe, expect, it } from "vitest";
import type { Operator } from "./adapters/identity";
import {
  GRAFANA_PATH,
  grafanaHeaders,
  grafanaReturnPath,
  grafanaRole,
  monitoringPath,
  quotedPrintable,
} from "./monitoring";

const as = (roles: string[], over: Partial<Operator> = {}) => ({
  status: "active",
  roles,
  permissions: [...permissionsOf(roles)],
  ...over,
});

/** Grafana's side of `headers_encoded = true` (Go's mime/quotedprintable). */
const decode = (value: string) =>
  new TextDecoder().decode(
    Uint8Array.from(
      value
        .replace(/=([0-9A-F]{2})|./gs, (match, hex: string | undefined) =>
          hex ? String.fromCharCode(Number.parseInt(hex, 16)) : match,
        )
        .split("")
        .map((char) => char.charCodeAt(0)),
    ),
  );

describe("the way back to Grafana", () => {
  it("keeps a Grafana path on this host with its query", () => {
    expect(
      grafanaReturnPath("/grafana/d/abc/overview?orgId=1&var-svc=payments"),
    ).toBe("/grafana/d/abc/overview?orgId=1&var-svc=payments");
    expect(grafanaReturnPath("/grafana/")).toBe("/grafana/");
    expect(grafanaReturnPath("/grafana")).toBe("/grafana/");
    // A URL inside the query is inert: it stays a query of a Grafana path.
    expect(grafanaReturnPath("/grafana/explore?left=https://x.test")).toBe(
      "/grafana/explore?left=https://x.test",
    );
  });

  it.each([
    ["an absolute URL", "https://evil.test/grafana/"],
    ["a protocol-relative URL", "//evil.test/grafana/"],
    ["a backslash host", "/\\evil.test/grafana/"],
    ["backslashes inside", "/grafana/\\..\\auth/sign-out"],
    ["dot segments", "/grafana/../auth/sign-out"],
    ["encoded dots", "/grafana/%2e%2e/auth/sign-out"],
    ["encoded slashes", "/grafana/..%2F..%2Fauth%2Fsign-out"],
    ["an encoded backslash", "/grafana/%5c..%5cusers"],
    ["a header split", "/grafana/\r\nSet-Cookie: og_at=x"],
    ["a tab the URL parser drops", "/\t/evil.test/grafana/"],
    ["a tab inside", "/grafana/\td/abc"],
    ["a neighbour path", "/grafanax/"],
    ["a console path", "/users"],
    ["a script URL", "javascript:alert(1)"],
    ["an empty value", ""],
    ["no value", null],
    ["a very long address", `/grafana/d/x?q=${"a".repeat(2100)}`],
  ])("falls back to /grafana/ for %s", (_, value) => {
    expect(grafanaReturnPath(value)).toBe(GRAFANA_PATH);
  });

  it("goes back through /monitoring with the path as one query value", () => {
    expect(monitoringPath("/grafana/d/abc?orgId=1&from=now-6h")).toBe(
      "/monitoring?to=%2Fgrafana%2Fd%2Fabc%3ForgId%3D1%26from%3Dnow-6h",
    );
  });
});

describe("Grafana's role", () => {
  it("makes an owner an Admin", () => {
    expect(grafanaRole(as(["owner"]))).toBe("Admin");
    expect(grafanaRole(as(["support", "owner"]))).toBe("Admin");
  });

  it("makes anyone else with monitoring.read a Viewer", () => {
    expect(grafanaRole(as(["auditor"]))).toBe("Viewer");
    expect(grafanaRole(as(["service_operator"]))).toBe("Viewer");
    expect(
      grafanaRole({
        status: "active",
        roles: [],
        permissions: ["monitoring.read"],
      }),
    ).toBe("Viewer");
  });

  it("keeps everyone else out", () => {
    expect(grafanaRole(as(["support"]))).toBeNull();
    expect(grafanaRole(as(["billing_operator"]))).toBeNull();
    expect(grafanaRole(as([]))).toBeNull();
    expect(grafanaRole(as(["pro"]))).toBeNull();
  });

  it("gives an account that is not active nothing, whatever its roles", () => {
    expect(grafanaRole(as(["owner"], { status: "suspended" }))).toBeNull();
    expect(grafanaRole(as(["auditor"], { status: "deleted" }))).toBeNull();
  });
});

describe("the auth proxy headers", () => {
  it("names the operator by the email in lower case", () => {
    expect(
      grafanaHeaders(
        { email: " Nick@Outegro.DEV ", displayName: "Nick Lukashik" },
        "Admin",
      ),
    ).toEqual({
      "X-WEBAUTH-USER": "nick@outegro.dev",
      "X-WEBAUTH-EMAIL": "nick@outegro.dev",
      "X-WEBAUTH-NAME": "Nick Lukashik",
      "X-WEBAUTH-ROLE": "Admin",
    });
  });

  it("falls back to the email when there is no display name", () => {
    for (const displayName of [null, "", "   "])
      expect(
        grafanaHeaders({ email: "ada@example.com", displayName }, "Viewer")?.[
          "X-WEBAUTH-NAME"
        ],
      ).toBe("ada@example.com");
  });

  it("encodes what a header cannot carry, and Grafana decodes it back", () => {
    const headers = grafanaHeaders(
      { email: "ops@example.com", displayName: "Николай Лукашик" },
      "Admin",
    );
    expect(headers?.["X-WEBAUTH-NAME"]).toMatch(/^[\x20-\x7e]+$/);
    expect(decode(headers?.["X-WEBAUTH-NAME"] ?? "")).toBe("Николай Лукашик");
    expect(quotedPrintable("a=b")).toBe("a=3Db");
    expect(decode(quotedPrintable("a=b ё"))).toBe("a=b ё");
  });

  it("never lets a name break the header", () => {
    const name = grafanaHeaders(
      { email: "x@example.com", displayName: "Eve\r\nX-WEBAUTH-ROLE: Admin" },
      "Viewer",
    )?.["X-WEBAUTH-NAME"];
    expect(name).toBe("Eve X-WEBAUTH-ROLE: Admin");
  });

  it("names nobody without an email", () => {
    expect(grafanaHeaders({ email: "", displayName: "Ghost" }, "Admin")).toBe(
      null,
    );
  });
});
