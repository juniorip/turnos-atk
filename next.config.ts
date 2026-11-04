import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  ...(process.env.TURNOS_UNIFIED_PATHS === "1" ? { basePath: "/turnos" } : {}),
  turbopack: { root: __dirname },
  // Permite usar Turnos ATK desde equipos conectados a la misma red local.
  allowedDevOrigins: ["192.168.1.67"],
};
export default nextConfig;
