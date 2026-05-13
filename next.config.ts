import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to this app, otherwise Next 16 detects
  // sibling lockfiles in the parent directory (../../package-lock.json from
  // the static-site repo this lives inside) and warns each build.
  turbopack: {
    root: path.resolve(__dirname),
  },
  async redirects() {
    return [
      // Admin chrome lives on admin.energytalentco.com. Anyone landing on
      // /admin/* via the candidate host (typed URL, bookmark, or an old
      // magic link sent before 9704906 pinned redirect_to to the admin
      // host) used to get a bare 404. Forward them so the auth callback
      // can do its job and ?error=… params still render on the login page.
      {
        source: "/admin/:path*",
        has: [{ type: "host", value: "assess.energytalentco.com" }],
        destination: "https://admin.energytalentco.com/admin/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
