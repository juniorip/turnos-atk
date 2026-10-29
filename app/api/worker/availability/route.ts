import { WorkerAvailability, UserRole } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ availability: z.enum(["AVAILABLE", "PAUSED"]) });

export async function POST(request: Request) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER);
    const body = schema.safeParse(await request.json());
    if (!body.success) return Response.json({ error: "Estado no válido." }, { status: 400 });
    const current = await prisma.user.findUnique({ where: { id: user.id }, select: { moduleNumber: true } });
    if (body.data.availability === "AVAILABLE" && !current?.moduleNumber) return Response.json({ error: "Asigna un módulo antes de activar la atención." }, { status: 400 });
    const worker = await prisma.user.update({
      where: { id: user.id },
      data: { availability: body.data.availability as WorkerAvailability, lastActiveAt: new Date() },
      select: { availability: true },
    });
    return Response.json(worker);
  } catch (error) { return errorResponse(error); }
}
