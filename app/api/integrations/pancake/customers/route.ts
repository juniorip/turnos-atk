import { UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { listPancakeCustomerNames, searchPancakeCustomersByDni } from "@/lib/pancake";

export const maxDuration = 60;

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Math.min(Math.max(Number(value), 1), maximum);
}

export async function GET(request: Request) {
  try {
    await requireUser(UserRole.ADMIN);
    const params = new URL(request.url).searchParams;
    const dniParam = params.get("dni");
    if (dniParam !== null) {
      const dni = dniParam.replace(/\D/g, "");
      if (dni.length < 8 || dni.length > 12) {
        return Response.json({ ok: false, error: "Ingresa un DNI válido de 8 a 12 dígitos." }, { status: 400 });
      }
      const result = await searchPancakeCustomersByDni(dni);
      const status = result.ok ? 200 : result.reason === "not_configured" ? 503 : 502;
      return Response.json({ ...result, dni, matchedField: "name" }, { status, headers: { "Cache-Control": "no-store" } });
    }

    const days = positiveInteger(params.get("days"), 30, 365);
    const page = positiveInteger(params.get("page"), 1, 10000);
    const pageSize = positiveInteger(params.get("pageSize"), 25, 100);
    const until = Math.floor(Date.now() / 1000);
    const since = until - days * 24 * 60 * 60;
    const result = await listPancakeCustomerNames({ since, until, page, pageSize });
    const status = result.ok ? 200 : result.reason === "not_configured" ? 503 : result.reason === "unauthorized" ? 502 : 502;
    return Response.json({ ...result, range: { days, page, pageSize } }, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
