import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack does not walk up into the home
  // directory looking for a lockfile.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
