import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH || "";
  return {
    id: `${appBasePath}/` || "/",
    name: "Turnos ATK",
    short_name: "Turnos ATK",
    description: "Gestión de atención y turnos",
    start_url: `${appBasePath}/` || "/",
    scope: `${appBasePath}/` || "/",
    display: "standalone",
    background_color: "#0a1422",
    theme_color: "#0a1422",
    icons: [
      { src: `${appBasePath}/icons/turnos-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${appBasePath}/icons/turnos-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
