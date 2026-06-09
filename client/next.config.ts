import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@mastra/libsql",
    "@libsql/client",
    "libsql",
    "mastra",
    "@mastra/core",
  ],
};

export default nextConfig;
