import { z } from "zod";
import { errorResponse } from "@/lib/auth";

const schema = z.object({ document: z.string().regex(/^\d{6,12}$/, "Ingresa un documento válido."), documentType: z.enum(["DNI", "CE"]).default("DNI") });

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Ingresa un DNI válido de 8 dígitos." }, { status: 400 });

    const token = process.env.JSONPE_API_TOKEN;
    if (!token) return Response.json({ error: "La consulta de DNI aún no está configurada." }, { status: 503 });

    const isDni = parsed.data.documentType === "DNI";
    if (isDni && !/^\d{8}$/.test(parsed.data.document)) return Response.json({ error: "El DNI debe tener 8 dígitos." }, { status: 400 });
    const response = await fetch(`https://api.json.pe/api/${isDni ? "dni" : "ce"}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(isDni ? { dni: parsed.data.document } : { ce: parsed.data.document }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => null);
    const fullName = result?.data?.nombre_completo || [result?.data?.apellido_paterno, result?.data?.apellido_materno, result?.data?.nombres].filter(Boolean).join(" ");
    if (!response.ok || !result?.success || !fullName) {
      return Response.json({ error: result?.message || "No se encontró el DNI." }, { status: response.status === 404 ? 404 : 502 });
    }
    return Response.json({ document: result.data.numero, fullName });
  } catch (error) {
    return errorResponse(error);
  }
}
