import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Monorepo root: standalone output must trace workspace packages too.
const root = path.join(process.cwd(), "../..");

// Every powerful feature off but the clipboard write of the kit's copy
// button (/design-system); autoplay keeps its default, the game's sounds
// start on timers after a click. Only names current Chrome parses: one it
// dropped (the ad auction and attribution features, ambient-light-sensor)
// costs a console warning on every page; interest-cohort went with FLoC.
const permissions = [
  "accelerometer=()",
  "bluetooth=()",
  "browsing-topics=()",
  "camera=()",
  "clipboard-read=()",
  "clipboard-write=(self)",
  "compute-pressure=()",
  "digital-credentials-get=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=()",
  "gamepad=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "identity-credentials-get=()",
  "idle-detection=()",
  "keyboard-map=()",
  "local-fonts=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "otp-credentials=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-create=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "storage-access=()",
  "usb=()",
  "window-management=()",
  "xr-spatial-tracking=()",
].join(", ");

// CSP with a per-request nonce is set in src/proxy.ts; the rest is static
// and goes on every response, build assets included.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // The other outegro.dev apps may embed these files, other sites may not.
  // No COEP: nothing here needs cross-origin isolation, and it would hold
  // every tag added in GTM to CORP.
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Permissions-Policy", value: permissions },
];

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  turbopack: { root },
  reactCompiler: true,
  transpilePackages: ["@outegro/ui", "@outegro/i18n", "@outegro/bff"],
  poweredByHeader: false,
  devIndicators: false,
  // One quality for every picture (the cover, screenshots, paper cut-outs).
  // WebP only: encoding AVIF pushed the server past its memory limit in
  // production (OOM kills) for a few percent in size.
  images: { formats: ["image/webp"], qualities: [75] },
  // A fresh pod optimises every image variant on first request: one libvips
  // thread per image, no operation cache, streamed decoding. The pod peaked
  // at 504 of its 512 MiB in production with the defaults (01.10.2026).
  experimental: {
    imgOptConcurrency: 1,
    imgOptOperationCache: false,
    imgOptSequentialRead: true,
  },
  async headers() {
    // The share cards (/og, /og/<locale>) and the tab and home-screen icons
    // (/favicon.ico, /icon, /apple-icon) are shown on other sites too (link
    // previews, OG debuggers, readers that hotlink them) and are the same
    // for everyone until the next deploy; next dev serves them uncached.
    const sharedFileHeaders = [
      { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
      ...(process.env.NODE_ENV === "production"
        ? [
            {
              key: "Cache-Control",
              value: "public, max-age=86400, stale-while-revalidate=604800",
            },
          ]
        : []),
    ];
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/:file(og|icon|apple-icon)/:locale?",
        headers: sharedFileHeaders,
      },
      { source: "/favicon.ico", headers: sharedFileHeaders },
      // Pages stay public; the SSO round trip and the account API carry
      // per-visitor cookies and state, so no cache may keep any of it.
      {
        source: "/:dir(auth|api)/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};
export default createNextIntlPlugin()(config);
