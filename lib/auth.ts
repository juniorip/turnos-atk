import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { UserRole } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { ensureTicketDistrictSchema } from "./ticket-district-schema";

function sessionSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret?.trim() || secret === "turnos-atk-local-only-change-me" || secret === "cambia-esto-por-un-secreto-largo-y-unico") {
    throw new Error("AUTH_SECRET debe configurarse con un secreto privado.");
  }
  // Leer al usar la sesión permite compilar sin secretos y conserva la clave
  // configurada en Vercel, incluidas las sesiones firmadas con ella.
  return new TextEncoder().encode(secret);
}
export type SessionUser = { id: number; role: UserRole; branchId: number | null; name: string; actingAs?: boolean; adminId?: number };
export const actingAsCookieName = "turnos_atk_acting_as";
export async function createActingAsToken(adminId: number, workerId: number) {
  return new SignJWT({ adminId, workerId, actingAs: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(sessionSecret());
}
export const credentialVersion = (passwordHash: string) => createHash("sha256").update(passwordHash).digest("hex");
export async function createSession(user: SessionUser, passwordHash: string) {
  return new SignJWT({ ...user, credentialVersion: credentialVersion(passwordHash) }).setProtectedHeader({ alg:"HS256" }).setIssuedAt().setExpirationTime("12h").sign(sessionSecret());
}
export async function sessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get("turnos_atk_session")?.value;
  if (!token) return null;
  let payload;
  try { payload = (await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] })).payload; } catch { return null; }
  if (!Number.isInteger(payload.id) || typeof payload.credentialVersion !== "string") return null;
  const current = await prisma.user.findUnique({ where: { id: payload.id as number }, select: { id: true, role: true, branchId: true, name: true, active: true, passwordHash: true } });
  if (!current?.active || payload.credentialVersion !== credentialVersion(current.passwordHash)) return null;
  if (current.role === UserRole.ADMIN) {
    const actingToken = (await cookies()).get(actingAsCookieName)?.value;
    if (actingToken) {
      try {
        const actingPayload = (await jwtVerify(actingToken, sessionSecret(), { algorithms: ["HS256"] })).payload;
        if (actingPayload.actingAs === true && actingPayload.adminId === current.id && Number.isInteger(actingPayload.workerId)) {
          const worker = await prisma.user.findFirst({ where: { id: actingPayload.workerId as number, active: true, role: { in: [UserRole.WORKER, UserRole.MANAGER] } }, select: { id: true, role: true, branchId: true, name: true } });
          if (worker) return { ...worker, actingAs: true, adminId: current.id };
        }
      } catch {
        // An expired or invalid impersonation token falls back to the admin session.
      }
    }
  }
  return { id: current.id, role: current.role, branchId: current.branchId, name: current.name };
}
export async function requireUser(...roles: UserRole[]) {
  const user = await sessionUser();
  if (!user || (roles.length && !roles.includes(user.role))) throw new Error("UNAUTHORIZED");
  await ensureTicketDistrictSchema();
  return user;
}
export function errorResponse(error: unknown) {
  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  if (!unauthorized) {
    // Keep diagnostics useful without logging query text, client data, or secrets.
    const candidate = error && typeof error === "object" ? error as { name?: unknown; code?: unknown } : {};
    const code = typeof candidate.code === "string" && /^P\d{4}$/.test(candidate.code) ? candidate.code : undefined;
    console.error("[api] request failed", {
      name: typeof candidate.name === "string" ? candidate.name : "UnknownError",
      ...(code ? { code } : {}),
    });
    const temporarilyUnavailable = ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(code || "");
    return Response.json(
      { error: temporarilyUnavailable ? "El servicio está temporalmente ocupado. Inténtalo nuevamente en unos segundos." : "No se pudo procesar la solicitud." },
      { status: temporarilyUnavailable ? 503 : 500 },
    );
  }
  return Response.json({ error: "No autorizado." }, { status: 401 });
}
