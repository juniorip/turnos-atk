import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Turnos ATK",
    short_name: "Turnos ATK",
    description: "Gestión de atención y turnos",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a1422",
    theme_color: "#0a1422",
    icons: [
      { src: "/icons/turnos-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/turnos-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
