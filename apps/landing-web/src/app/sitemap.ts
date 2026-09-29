import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://outegro.dev/", changeFrequency: "monthly", priority: 1 },
    {
      url: "https://outegro.dev/stack",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: "https://outegro.dev/privacy",
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
