import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Monorepo root: standalone output must trace workspace packages too.
const root = path.join(process.cwd(), "../..");

// CSP with a per-request nonce is set in src/proxy.ts; the rest is static.
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
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
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
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages stay public; the SSO round trip carries per-visitor cookies
      // and state, so no shared cache may keep any of it.
      {
        source: "/auth/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};
export default createNextIntlPlugin()(config);
