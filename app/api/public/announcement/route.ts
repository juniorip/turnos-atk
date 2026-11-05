import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canonicalBranchCode, ensureCoreBranches } from "@/lib/branches";

const voiceId = "EXAVITQu4vr4xnSDxMaL"; // Sarah, voz predeterminada disponible en el plan gratuito.

function displayName(clientName: string) {
  const [lastNames, firstNames] = clientName.split(",");
  if (firstNames) return `${firstNames.trim().split(/\s+/)[0]} ${lastNames.trim().split(/\s+/)[0]}`;
  return clientName.trim().split(/\s+/).slice(0, 2).join(" ");
}

// Only synthesize announcements for a ticket currently being called at an active branch.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const requestedBranchCode = query.get("branch")?.trim();
  const branchCode = requestedBranchCode ? canonicalBranchCode(requestedBranchCode) : null;
  const ticketCode = query.get("ticket")?.trim().toUpperCase();

  if (!branchCode || !ticketCode) {
    return Response.json({ error: "El anuncio no es válido." }, { status: 400 });
  }

  await ensureCoreBranches();

  const branch = await prisma.branch.findFirst({
    where: { code: branchCode, active: true },
    select: { id: true },
  });
  if (!branch) return Response.json({ error: "La sede no está disponible." }, { status: 404 });

  const testMode = query.get("test") === "1" && ticketCode === "PRUEBA-VOZ";
  let text: string;
  if (testMode) {
    text = "Cliente de prueba, acérquese al módulo uno.";
  } else {
    const ticket = await prisma.ticket.findFirst({
      where: { branchId: branch.id, code: ticketCode, status: TicketStatus.CALLED },
      select: { clientName: true, assignedTo: { select: { moduleNumber: true } } },
      orderBy: { updatedAt: "desc" },
    });
    if (!ticket) return Response.json({ error: "El turno ya no está siendo llamado." }, { status: 404 });

    const moduleNumber = ticket.assignedTo?.moduleNumber || 1;
    text = `${displayName(ticket.clientName)}, acérquese al módulo ${moduleNumber}.`;
  }

  try {
    const client = new ElevenLabsClient();
    const audio = await client.textToSpeech.convert(voiceId, {
      text,
      modelId: "eleven_flash_v2_5",
      voiceSettings: { stability: 0.65, similarityBoost: 0.75 },
    });
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : 0;
    const errorBody = typeof error === "object" && error !== null && "body" in error
      ? (error as { body?: { detail?: { code?: string } } }).body
      : undefined;
    const providerCode = errorBody?.detail?.code;
    const message = status === 402 && providerCode === "paid_plan_required"
      ? "La voz seleccionada requiere un plan de pago de ElevenLabs."
      : status === 402
      ? "ElevenLabs rechazó la generación de voz. Revisa el estado del plan y de la cuenta."
      : status === 401 || status === 403
        ? "ElevenLabs rechazó la clave de API configurada."
        : status === 429
          ? "ElevenLabs alcanzó su límite de solicitudes. Intenta nuevamente en un momento."
          : "ElevenLabs no pudo generar el audio. Intenta nuevamente.";
    return Response.json({ error: message }, { status: 502 });
  }
}
