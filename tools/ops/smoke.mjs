// Production smoke test (R-04 TC-R-04-03): what a visitor, a signed-out
// user and an attacker see on every outegro.dev site, without signing in
// and without any purchase. Read-only: GET requests and TLS handshakes only.
//
//   node tools/ops/smoke.mjs                 # outegro.dev
//   SMOKE_DOMAIN=example.test node tools/ops/smoke.mjs
//   SMOKE_SKIP=edu node tools/ops/smoke.mjs  # a site that is not out yet
//
// Exit code 1 when any check fails; the table says which and why.
import tls from "node:tls";

const domain = process.env.SMOKE_DOMAIN ?? "outegro.dev";
const site = (sub) => `https://${sub ? `${sub}.` : ""}${domain}`;
/** Sites to leave out, e.g. `edu` before its first rollout. */
const skip = new Set((process.env.SMOKE_SKIP ?? "").split(",").filter(Boolean));
const apps = [
  ["landing-web", site("")],
  ["id-web", site("id")],
  ["pay-web", site("pay")],
  ["admin-web", site("admin")],
  ["battleship-web", site("battleship")],
  ["edu-web", site("edu")],
].filter(([app]) => !skip.has(app.replace(/-web$/, "")));
const MIN_CERT_DAYS = 14;

const results = [];
const check = async (name, run) => {
  const started = performance.now();
  try {
    const note = await run();
    results.push({ name, ok: true, note: note ?? "", ms: performance.now() - started });
  } catch (error) {
    results.push({ name, ok: false, note: error.message, ms: performance.now() - started });
  }
};
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const get = (url, headers = {}) =>
  fetch(url, { redirect: "manual", headers: { "user-agent": "outegro-smoke/1", ...headers } });

/** Signed out, a private page sends the browser to its app's sign-in. */
const gated = async (url, signIn) => {
  const res = await get(url);
  const header = res.headers.get("location");
  expect(
    [302, 303, 307].includes(res.status) && header,
    `expected a redirect, got ${res.status}`,
  );
  // Next.js answers with a relative Location; the browser resolves it here.
  const location = new URL(header, url);
  expect(location.href.startsWith(signIn), `redirects to ${location.href}`);
  return `${res.status} → ${location.pathname}`;
};

// Public pages and health.
for (const [app, base] of apps)
  await check(`${app} /health`, async () => {
    const res = await get(`${base}/health`);
    expect(res.status === 200, `status ${res.status}`);
    const body = await res.json();
    expect(body.status === "ok" && body.service === app, JSON.stringify(body));
    return "ok";
  });
await check("landing: home and /stack render, unknown path is 404", async () => {
  for (const path of ["/", "/stack"]) {
    const res = await get(`${site("")}${path}`);
    expect(res.status === 200, `${path}: ${res.status}`);
    const html = await res.text();
    expect(html.includes("outegro"), `${path}: no outegro in the page`);
  }
  const missing = await get(`${site("")}/smoke-${Date.now()}`);
  expect(missing.status === 404, `unknown path: ${missing.status}`);
  return "200, 200, 404";
});
await check("id: sign-in page allows passkeys", async () => {
  const res = await get(`${site("id")}/login`);
  expect(res.status === 200, `status ${res.status}`);
  const policy = res.headers.get("permissions-policy") ?? "";
  expect(policy.includes("publickey-credentials-get=(self)"), `Permissions-Policy: ${policy}`);
  return "200, publickey-credentials";
});
await check("battleship: landing is public", async () => {
  const res = await get(site("battleship"));
  expect(res.status === 200, `status ${res.status}`);
  return "200";
});

if (!skip.has("edu"))
  await check("edu: library is public", async () => {
    const res = await get(site("edu"));
    expect(res.status === 200, `status ${res.status}`);
    return "200";
  });

// Private pages: signed out means a trip to sign-in, never content.
await check("id: account needs sign-in", () => gated(`${site("id")}/account`, `${site("id")}/login`));
for (const path of ["/", "/catalog", "/subscriptions"])
  await check(`pay: ${path} needs sign-in`, () =>
    gated(`${site("pay")}${path}`, `${site("pay")}/auth/sign-in`),
  );
await check("admin: console needs sign-in", () =>
  gated(`${site("admin")}/`, `${site("admin")}/auth/sign-in`),
);
await check("battleship: play needs sign-in", () =>
  gated(`${site("battleship")}/play`, `${site("battleship")}/auth/sign-in`),
);

// Attacks that must not work.
await check("admin: Grafana ignores forged identity headers", async () => {
  const res = await get(`${site("admin")}/grafana/api/user`, {
    "x-webauth-user": "owner@outegro.dev",
    "x-webauth-role": "Admin",
  });
  expect(res.status !== 200, "forged headers were accepted");
  return `${res.status}`;
});
await check("hooks: webhooks answer nothing to GET", async () => {
  for (const path of ["/lava", "/telegram"]) {
    const res = await get(`${site("hooks")}${path}`);
    expect(res.status === 404 || res.status === 405, `${path}: ${res.status}`);
  }
  return "404, 404";
});

// Headers every HTML page carries.
for (const [app, base] of apps.filter(([app]) => app !== "admin-web"))
  await check(`${app}: security headers`, async () => {
    // A page that renders signed out (pay-web's home is a redirect).
    const path = { "id-web": "/login", "pay-web": "/signed-out" }[app] ?? "/";
    const res = await get(`${base}${path}`);
    const missing = [
      ["content-security-policy", (v) => v.includes("frame-ancestors 'none'")],
      ["x-content-type-options", (v) => v === "nosniff"],
      ["referrer-policy", (v) => v.length > 0],
    ].filter(([header, ok]) => !ok(res.headers.get(header) ?? ""));
    expect(missing.length === 0, `missing or weak: ${missing.map(([h]) => h).join(", ")}`);
    expect(!res.headers.get("x-powered-by"), "x-powered-by is set");
    return "CSP, nosniff, referrer";
  });

// TLS: every name has a certificate far enough from expiry.
const certificate = (host) =>
  new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert);
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error("TLS timeout")));
    socket.on("error", reject);
  });
for (const host of [
  domain,
  ...["id", "pay", "admin", "battleship", "edu", "hooks"]
    .filter((sub) => !skip.has(sub))
    .map((sub) => `${sub}.${domain}`),
])
  await check(`TLS ${host}`, async () => {
    const cert = await certificate(host);
    const days = Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000);
    expect(days >= MIN_CERT_DAYS, `expires in ${days} days`);
    return `${days} days left`;
  });

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results)
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${String(Math.round(r.ms)).padStart(5)} ms  ${r.note}`,
  );
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed against ${domain}`);
process.exit(failed ? 1 : 0);
