import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The sign-in round trip and the account API are for people, and
      // lead crawlers off to id.outegro.dev's sign-in pages.
      disallow: ["/design-system", "/health", "/auth/", "/api/"],
    },
    sitemap: "https://outegro.dev/sitemap.xml",
  };
}
