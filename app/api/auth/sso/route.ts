import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { UserRole, WorkerAvailability } from "@prisma/client";
import { findOrCreateBranch } from "@/lib/branches";
import { getTurnosBranchName } from "@/lib/branch-overrides";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type PortalIdentity = { name?: string; username?: string; dni?: string | null; role?: string; sede?: string };

export async function POST(request: Request) {
  const baseUrl = process.env.REGISTROS_ATK_URL?.replace(/\/$/, "");
  const sharedSecret = process.env.REGISTROS_ATK_SHARED_SECRET;
  if (!baseUrl || !sharedSecret) return Response.json({ error: "El acceso unificado no está configurado." }, { status: 503 });

  let grant = "";
  try { grant = String((await request.formData()).get("grant") || ""); }
  catch { return Response.json({ error: "Código de acceso inválido." }, { status: 400 }); }
  if (!grant) return Response.json({ error: "Falta el código de acceso. Inicia sesión nuevamente." }, { status: 400 });

  try {
    const response = await fetch(`${baseUrl}/api/external/turnos/sso/consume`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Turnos-ATK-Key": sharedSecret },
      body: JSON.stringify({ code: grant }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json().catch(() => ({})) as { user?: PortalIdentity; error?: string };
    if (!response.ok || !payload.user?.username || !payload.user.name || !payload.user.sede) {
      const status = response.status === 401 || response.status === 403 ? 401 : response.status === 400 ? 400 : 503;
      return Response.json({ error: payload.error || "El acceso venció. Inicia sesión nuevamente." }, { status });
    }

    const source = payload.user;
    const username = source.username;
    const name = source.name;
    const sede = source.sede;
    if (!username || !name || !sede) return Response.json({ error: "La cuenta no tiene datos suficientes para entrar a Turnos." }, { status: 401 });
    const role: UserRole = source.role === "ADMIN" ? UserRole.ADMIN : source.role === "MANAGER" ? UserRole.MANAGER : UserRole.WORKER;
    const branch = await findOrCreateBranch(getTurnosBranchName(username, sede));
    const existing = await prisma.user.findUnique({ where: { username }, include: { branch: true } });
    let user;
    if (existing) {
      if (!existing.active) return Response.json({ error: "La cuenta de Turnos está desactivada. Contacta al administrador." }, { status: 403 });
      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
          dni: source.dni || existing.dni,
          role,
          branchId: branch.id,
          availability: branch.id === existing.branchId ? undefined : WorkerAvailability.PAUSED,
        },
        include: { branch: true },
      });
    } else {
      const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
      user = await prisma.user.create({
        data: { name, username, dni: source.dni || null, passwordHash, role, active: true, branchId: branch.id },
        include: { branch: true },
      });
    }
    if (user.role === UserRole.WORKER || user.role === UserRole.MANAGER) {
      user = await prisma.user.update({ where: { id: user.id }, data: { availability: user.moduleNumber ? user.availability : WorkerAvailability.PAUSED, lastActiveAt: new Date() }, include: { branch: true } });
    }
    const token = await createSession({ id: user.id, role: user.role, branchId: user.branchId, name: user.name }, user.passwordHash);
    const target = new URL("/", request.url);
    const result = Response.redirect(target, 303);
    result.headers.append("Set-Cookie", `turnos_atk_session=${token}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    result.headers.set("Cache-Control", "no-store");
    return result;
  } catch (error) {
    console.error("Turnos unified login failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ error: "No se pudo completar el acceso. Vuelve al portal e intenta otra vez." }, { status: 503 });
  }
}
