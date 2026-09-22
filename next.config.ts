import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/curriculum-visuals/*": ["./curriculum/assets/visuals/**/*"],
  },
};

export default nextConfig;
