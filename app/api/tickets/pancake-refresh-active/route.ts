import { UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";

// Kept as a retired endpoint so older browser tabs cannot trigger Pancake
// lookups for tickets that have already left the waiting queue.
export async function POST() {
  try {
    await requireUser(UserRole.ADMIN, UserRole.WORKER, UserRole.MANAGER);
    return Response.json(
      { error: "La búsqueda de Pancake solo se realiza mientras el ticket está en cola." },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
