import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const configuredRecordsUrl = process.env.REGISTROS_ATK_URL?.replace(/\/$/, "");
  const configuredPortalUrl = process.env.REGISTROS_ATK_PORTAL_URL?.replace(/\/$/, "");
  const portalUrl = configuredPortalUrl || (process.env.NODE_ENV === "development" ? "http://localhost:3100" : configuredRecordsUrl || "https://atkportal.app");
  const target = `${portalUrl}/?portal=turnos`;
  return NextResponse.redirect(new URL(target, request.url), 303);
}
