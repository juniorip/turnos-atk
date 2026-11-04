import { UserRole, WorkerAvailability } from "@prisma/client";
import { actingAsCookieName, sessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const cookiePath = process.env.NEXT_PUBLIC_APP_BASE_PATH || "/";
  const user = await sessionUser();
  if (user && !user.actingAs && (user.role === UserRole.WORKER || user.role === UserRole.MANAGER)) {
    await prisma.user.update({ where: { id: user.id }, data: { availability: WorkerAvailability.PAUSED } });
  }
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `turnos_atk_session=; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=0`);
  response.headers.append("Set-Cookie", `${actingAsCookieName}=; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
