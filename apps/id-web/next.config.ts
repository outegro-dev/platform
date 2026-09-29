import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const root = path.join(process.cwd(), "../..");

// CSP with a per-request nonce is set in src/proxy.ts.
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
    // Passkeys (ID-05): WebAuthn on this origin only, never in a frame of
    // another site (frames are refused anyway by X-Frame-Options).
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
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
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages carry personal data and are never stored. Hashed build assets
      // (CSS, JS, fonts) keep the immutable caching Next.js gives them;
      // otherwise every reload refetches the fonts and shifts the layout.
      {
        source: "/((?!_next/static|_next/image).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};
export default createNextIntlPlugin()(config);
