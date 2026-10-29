import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { UserRole, WorkerAvailability } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { z } from "zod";
import { getTurnosBranchName } from "@/lib/branch-overrides";
import { findOrCreateBranch } from "@/lib/branches";
const schema = z.object({ username:z.string().min(1), password:z.string().min(1) });

async function syncUserFromRegistros(username: string, password: string) {
  const baseUrl = process.env.REGISTROS_ATK_URL?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("REGISTROS_ATK_UNCONFIGURED");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("REGISTROS_ATK_UNAVAILABLE");
  }
  if (response.status === 401 || response.status === 400) return null;
  if (!response.ok) throw new Error("REGISTROS_ATK_UNAVAILABLE");
  let payload: { currentUser?: { name?: string; username?: string; dni?: string | null; role?: string; sede?: string } };
  try {
    payload = await response.json();
  } catch {
    throw new Error("REGISTROS_ATK_INVALID_RESPONSE");
  }
  const source = payload.currentUser as
    | { name?: string; username?: string; dni?: string | null; role?: string; sede?: string }
    | undefined;
  if (!source?.username || !source.name || !source.sede?.trim()) throw new Error("REGISTROS_ATK_INVALID_RESPONSE");

  // External authentication must not undo local account restrictions.
  const existing = await prisma.user.findUnique({ where: { username: source.username }, include: { branch: true } });
  if (existing) {
    if (!existing.active) return null;
    const branch = await findOrCreateBranch(getTurnosBranchName(source.username, source.sede));
    return prisma.user.update({ where: { id: existing.id, active: true }, data: { name: source.name, dni: source.dni || existing.dni, branchId: branch.id, availability: branch.id === existing.branchId ? undefined : WorkerAvailability.PAUSED }, include: { branch: true } });
  }

  const branch = await findOrCreateBranch(getTurnosBranchName(source.username, source.sede));
  const role: UserRole = source.role === "ADMIN" ? UserRole.ADMIN : source.role === "MANAGER" ? UserRole.MANAGER : UserRole.WORKER;
  // Registros ATK verifies the credential. Store only an unrelated random hash
  // locally so Turnos sessions can still be revoked against the current user row.
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
  const user = await prisma.user.upsert({
    where: { username: source.username },
    update: {},
    create: { name: source.name, username: source.username, dni: source.dni || null, passwordHash, role, active: true, branchId: branch.id },
    include: { branch: true },
  });
  // A locally created account starts without service permissions or a module.
  // The administrator assigns those explicitly.
  return user;
}

export async function POST(request: Request) {
  const parsed=schema.safeParse(await request.json()); if(!parsed.success) return Response.json({error:"Completa usuario y contraseña."},{status:400});
  let user;
  try {
    const localDemoMode = process.env.NODE_ENV === "development" && process.env.TURNOS_LOCAL_DEMO_AUTH === "1" && !process.env.REGISTROS_ATK_URL;
    if (localDemoMode) {
      // This fallback is opt-in and development-only. It authenticates solely
      // against the isolated local database and cannot affect production login.
      const localUser = await prisma.user.findUnique({ where: { username: parsed.data.username.trim() }, include: { branch: true } });
      user = localUser?.active && await bcrypt.compare(parsed.data.password, localUser.passwordHash) ? localUser : null;
    } else {
      // In production always consult the source of truth. A stale local
      // password must never continue working after Registros ATK changes it.
      user = await syncUserFromRegistros(parsed.data.username.trim(), parsed.data.password);
    }
  } catch (error) {
    const unavailable = error instanceof Error && error.message.startsWith("REGISTROS_ATK_");
    return Response.json({ error: unavailable ? "No se pudo validar el acceso con Registros ATK. Intenta nuevamente." : "No se pudo procesar el inicio de sesión." }, { status: unavailable ? 503 : 500 });
  }
  if(!user || !user.active) return Response.json({error:"Usuario o contraseña incorrectos."},{status:401});
  if (user.role === UserRole.WORKER || user.role === UserRole.MANAGER) {
    user = await prisma.user.update({ where: { id: user.id }, data: { availability: user.moduleNumber ? user.availability : WorkerAvailability.PAUSED, lastActiveAt: new Date() }, include: { branch: true } });
  }
  const token=await createSession({id:user.id,role:user.role,branchId:user.branchId,name:user.name}, user.passwordHash);
  const response=Response.json({user:{name:user.name,role:user.role,branch:user.branch?.name || null}});
  response.headers.append("Set-Cookie",`turnos_atk_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`); return response;
}
