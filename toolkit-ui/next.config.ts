import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async rewrites() {
    return [
      {
        source: "/socket.io",
        destination: `${process.env.SERVER_URL}/socket.io/`,
      },
      {
        source: "/devices",
        destination: `${process.env.SERVER_URL}/devices`,
      },
      {
        source: "/reset",
        destination: `${process.env.SERVER_URL}/reset`,
      },
    ];
  },
  reactCompiler: true,
};

export default nextConfig;
