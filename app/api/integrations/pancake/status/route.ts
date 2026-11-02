import { UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { checkPancakeConnection } from "@/lib/pancake";

export async function GET() {
  try {
    await requireUser(UserRole.ADMIN);
    return Response.json(await checkPancakeConnection(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
