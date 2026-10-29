import type { MetadataRoute } from "next";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sede: string }> },
) {
  const { sede } = await params;
  const branchCode = encodeURIComponent(sede.toUpperCase());

  const manifest: MetadataRoute.Manifest = {
    id: "/",
    name: "Turnos ATK",
    short_name: "Turnos ATK",
    description: "Gestión de atención y turnos",
    start_url: `/registro/${branchCode}`,
    scope: "/",
    display: "standalone",
    background_color: "#0a1422",
    theme_color: "#0a1422",
    icons: [
      { src: "/icons/turnos-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/turnos-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };

  return Response.json(manifest, {
    headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
  });
}
