import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    '/app/reports/export': ['./src/features/reporting/fonts/*.ttf', './public/brand/fixxflow/logo/fixxflow-logo-horizontal.png'],
    '/app/reports/export/custom': ['./src/features/reporting/fonts/*.ttf', './public/brand/fixxflow/logo/fixxflow-logo-horizontal.png'],
    '/api/cron/reports': ['./src/features/reporting/fonts/*.ttf', './public/brand/fixxflow/logo/fixxflow-logo-horizontal.png'],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/sign/**",
      },
    ],
  },
};

export default nextConfig;
