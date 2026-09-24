import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/**": ["./assets/fonts/*.ttf", "./node_modules/@twemoji/svg/*.svg"],
  },
};

export default nextConfig;
