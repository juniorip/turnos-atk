import { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { z } from "zod";
import { actingAsCookieName, createActingAsToken, errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { registrosATKUserRoster } from "@/lib/registros-atk-user-roster";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), workerId: z.number().int().positive() }),
  z.object({ action: z.literal("stop") }),
]);

export async function POST(request: Request) {
  try {
    const body = requestSchema.safeParse(await request.json());
    if (!body.success) return Response.json({ error: "Solicitud inválida." }, { status: 400 });

    const cookieStore = await cookies();
    if (body.data.action === "stop") {
      cookieStore.delete(actingAsCookieName);
      return Response.json({ ok: true });
    }

    const admin = await requireUser(UserRole.ADMIN);
    const worker = await prisma.user.findFirst({ where: { id: body.data.workerId, role: { in: [UserRole.WORKER, UserRole.MANAGER] }, active: true }, select: { id: true, username: true } });
    if (!worker) return Response.json({ error: "No se encontró un colaborador activo." }, { status: 404 });
    const roster = await registrosATKUserRoster();
    const username = worker.username.trim().toLowerCase();
    if (roster.activeUsernames ? !roster.activeUsernames.has(username) : roster.inactiveUsernames.has(username)) {
      return Response.json({ error: "Este colaborador ya no está activo en Registros ATK." }, { status: 404 });
    }

    const token = await createActingAsToken(admin.id, worker.id);
    cookieStore.set(actingAsCookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
