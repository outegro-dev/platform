import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const root = path.join(process.cwd(), "../..");

// CSP with a per-request nonce (and the game WebSocket origin) is set in src/proxy.ts.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  turbopack: { root },
  // No React Compiler here, unlike the other platform apps. The game screens
  // are MobX observers: they re-render when an observable they *read during
  // render* changes (store.match.turn, clock.now, …). The compiler memoizes
  // JSX by the identity of props, state and hook results; a store is one
  // stable object, so a compiled observer can hand back cached JSX after
  // MobX has scheduled the re-render, and the board goes stale. "use no memo"
  // in every observer would work, but one forgotten directive is a silent
  // bug, so the whole app opts out instead.
  reactCompiler: false,
  transpilePackages: ["@outegro/ui", "@outegro/i18n", "@outegro/bff"],
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages carry personal data and are never stored. Hashed build assets
      // (CSS, JS, fonts) keep the immutable caching Next.js gives them, so a
      // reload never refetches fonts and shifts the layout.
      {
        source: "/((?!_next/static|_next/image).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};
export default createNextIntlPlugin()(config);
