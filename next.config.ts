import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
