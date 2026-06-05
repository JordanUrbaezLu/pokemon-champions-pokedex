import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Sprites and official artwork are served from the PokeAPI sprite repo.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/PokeAPI/sprites/**",
      },
    ],
  },
};

export default nextConfig;
