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
};

export default nextConfig;
