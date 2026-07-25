import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/desk", "/api/"] },
    ],
    sitemap: "https://www.terraveler.com/sitemap.xml",
    host: "https://www.terraveler.com",
  };
}
