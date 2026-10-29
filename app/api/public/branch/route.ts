import { prisma } from "@/lib/prisma";
import { canonicalBranchCode, ensureCoreBranches } from "@/lib/branches";

export async function GET(request: Request) {
  const requestedCode = new URL(request.url).searchParams.get("code")?.trim();
  if (!requestedCode) return Response.json({ error: "Sede inválida." }, { status: 400 });
  const code = canonicalBranchCode(requestedCode);

  await ensureCoreBranches();
  const branch = await prisma.branch.findFirst({ where: { code, active: true }, select: { id: true, name: true, code: true } });
  const services = await prisma.service.findMany({ where: { active: true, name: { not: "Plan de retención" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (!branch) return Response.json({ error: "Esta sede no está disponible." }, { status: 404 });
  return Response.json({ branch, services });
}
