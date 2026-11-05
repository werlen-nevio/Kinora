import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ["sharp", "pg", "@prisma/adapter-pg", "nodemailer"],
  // Die Analyse der Standalone-Ausgabe erfasst nur die .node-Datei von sharp, nicht die
  // daneben liegende libvips. Ohne diese Zeile lädt sharp in Produktion nicht.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/sharp/**", "./node_modules/@img/**"],
  },
  images: {
    // Alle TMDB-Bilder laufen über einen eigenen Loader direkt vom TMDB-CDN.
    deviceSizes: [360, 640, 828, 1080, 1280, 1920, 2560, 3840],
    imageSizes: [45, 92, 154, 185, 240, 342, 500],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;
