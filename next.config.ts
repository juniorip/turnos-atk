import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  // Permite usar Turnos ATK desde equipos conectados a la misma red local.
  allowedDevOrigins: ["192.168.1.67"],
};
export default nextConfig;
