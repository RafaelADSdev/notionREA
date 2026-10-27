import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.NEXT_TEST_BUILD === "true" ? ".next-test" : ".next",
  typescript: {
    tsconfigPath:
      process.env.NEXT_TEST_BUILD === "true" ? ".supabase/testing/tsconfig.json" : "tsconfig.json",
  },
  poweredByHeader: false,
  outputFileTracingIncludes: { "/api/documents/*": ["./.editor-runtime/validation-worker.mjs"] },
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
