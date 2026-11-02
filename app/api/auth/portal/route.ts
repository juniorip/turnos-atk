import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const localRecordsUrl = "http://localhost:3001/?portal=turnos";
  const configuredRecordsUrl = process.env.REGISTROS_ATK_URL?.replace(/\/$/, "");
  const target = process.env.NODE_ENV === "development"
    ? (process.env.NEXT_PUBLIC_REGISTROS_ATK_PORTAL_URL || localRecordsUrl)
    : `${configuredRecordsUrl || "https://atkportal.app"}/?portal=turnos`;
  return NextResponse.redirect(new URL(target, request.url), 303);
}
