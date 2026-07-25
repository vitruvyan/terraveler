import type { MetadataRoute } from "next";
import { ATLAS } from "@/lib/voyages";

const BASE = "https://www.terraveler.com";

/** Static pages + every published voyage (map view and its text log). Next
 *  serves this at /sitemap.xml automatically. */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/voyages`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/contribute`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/how-it-works`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/magna-carta`, changeFrequency: "monthly", priority: 0.4 },
  ];

  const voyagePages: MetadataRoute.Sitemap = ATLAS.flatMap((v) => {
    const href = v.href === "/" ? "/voyage/boudeuse-1766" : v.href;
    return [
      { url: `${BASE}${href}`, changeFrequency: "monthly" as const, priority: 0.85 },
      { url: `${BASE}${href}/log`, changeFrequency: "monthly" as const, priority: 0.8 },
    ];
  });

  return [...staticPages, ...voyagePages];
}
