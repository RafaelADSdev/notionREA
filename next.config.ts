import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  logging: { incomingRequests: { ignore: [/\/auth\/callback/] }, fetches: { fullUrl: false } },
  experimental: { serverActions: { bodySizeLimit: "256kb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};
export default config;
