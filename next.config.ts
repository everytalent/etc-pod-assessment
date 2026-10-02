import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to this app, otherwise Next 16 detects
  // sibling lockfiles in the parent directory (../../package-lock.json from
  // the static-site repo this lives inside) and warns each build.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Only the platform shell may frame these pages; everything else is
  // refused. nosniff and a referrer policy are the other two cheap wins.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://app.everytalentco.com",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
