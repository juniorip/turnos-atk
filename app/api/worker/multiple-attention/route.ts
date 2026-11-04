import { UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || typeof (body as { enabled?: unknown }).enabled !== "boolean") {
      return Response.json({ error: "Indica si deseas activar o desactivar la atención múltiple." }, { status: 400 });
    }
    const enabled = (body as { enabled: boolean }).enabled;
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { multipleAttentionEnabled: enabled },
      select: { multipleAttentionEnabled: true },
    });
    return Response.json({ enabled: updated.multipleAttentionEnabled });
  } catch (error) {
    return errorResponse(error);
  }
}
