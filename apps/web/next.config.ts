import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Domain ships raw TS via workspace source; transpile it into the bundle.
  transpilePackages: ["@debt-copilot/domain"],
};

export default nextConfig;
