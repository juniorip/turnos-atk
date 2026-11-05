import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "development" && process.env.TURNOS_LOCAL_DEMO_AUTH === "1") {
    const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH || "";
    return NextResponse.redirect(new URL(`${basePath}/acceso-local.html`, request.url), 303);
  }
  const configuredRecordsUrl = process.env.REGISTROS_ATK_URL?.replace(/\/$/, "");
  const configuredPortalUrl = process.env.REGISTROS_ATK_PORTAL_URL?.replace(/\/$/, "");
  const portalUrl = configuredPortalUrl || (process.env.NODE_ENV === "development" ? "http://localhost:3100" : configuredRecordsUrl || "https://atkportal.app");
  const target = `${portalUrl}/?portal=turnos`;
  return NextResponse.redirect(new URL(target, request.url), 303);
}
