import { UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";

// Tickets are now claimed manually by the next available advisor in FIFO order.
// Keep this endpoint for older open clients, but never assign tickets automatically.
export async function POST() {
  try {
    await requireUser(UserRole.WORKER, UserRole.MANAGER);
    return Response.json({ assigned: 0, mode: "manual" });
  } catch (error) {
    return errorResponse(error);
  }
}
