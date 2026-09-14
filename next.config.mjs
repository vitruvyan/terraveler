/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "commons.wikimedia.org" },
    ],
  },
  outputFileTracingIncludes: {
    "/magna-carta": ["./MAGNA_CARTA.md"],
    "/how-it-works": ["./docs/HOW_IT_WORKS.md"],
  },

  // ---------------------------------------------------------------------------
  // Security headers — applied to every response.
  //
  // Content-Security-Policy notes:
  //   • 'unsafe-inline' in script-src is required by the layout-mode script
  //     injected via dangerouslySetInnerHTML in layout.tsx. A nonce-based
  //     approach is the P2 follow-up.
  //   • blob: in worker-src is required by MapLibre GL, which instantiates a
  //     web worker from a blob URL.
  //   • The img-src list mirrors next.config images.remotePatterns plus the
  //     CARTO/OPM planetary tile server.
  // ---------------------------------------------------------------------------
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://upload.wikimedia.org https://commons.wikimedia.org https://cartocdn-gusc.global.ssl.fastly.net",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

