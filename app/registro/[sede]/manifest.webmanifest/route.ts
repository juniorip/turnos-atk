import type { MetadataRoute } from "next";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sede: string }> },
) {
  const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH || "";
  const { sede } = await params;
  const branchCode = encodeURIComponent(sede.toUpperCase());

  const manifest: MetadataRoute.Manifest = {
    id: `${appBasePath}/` || "/",
    name: "Turnos ATK",
    short_name: "Turnos ATK",
    description: "Gestión de atención y turnos",
    start_url: `${appBasePath}/registro/${branchCode}`,
    scope: `${appBasePath}/` || "/",
    display: "standalone",
    background_color: "#0a1422",
    theme_color: "#0a1422",
    icons: [
      { src: `${appBasePath}/icons/turnos-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${appBasePath}/icons/turnos-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };

  return Response.json(manifest, {
    headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
  });
}
