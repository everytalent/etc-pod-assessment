import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to this app, otherwise Next 16 detects
  // sibling lockfiles in the parent directory (../../package-lock.json from
  // the static-site repo this lives inside) and warns each build.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
