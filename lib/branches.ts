import { WorkerAvailability } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Several names refer to the same physical office. Keep one canonical branch
// row so queues, users, modules, rooms, and reports all share the same scope.
export const coreBranches = [
  { code: "LIN", name: "Lince", aliases: ["lin", "lince", "centro", "cen"] },
  {
    code: "SUR",
    name: "Sur",
    aliases: ["sur", "sjm", "san", "san juan de miraflores", "san juan miraflores"],
  },
  { code: "NOR", name: "Norte", aliases: ["nor", "norte", "oli", "los", "olivos", "los olivos"] },
] as const;

const legacyBranchCodes: Record<string, string> = {
  miraflores: "MIR",
  pagos: "PAG",
  marketing: "MKT",
  facturacion: "FAC",
};

const duplicateBranches = [
  { target: "LIN", codes: ["CEN"], names: ["Centro"] },
  { target: "SUR", codes: ["SJM", "SAN"], names: ["SJM", "San Juan de Miraflores", "San Juan Miraflores"] },
  { target: "NOR", codes: ["OLI", "LOS"], names: ["OLI", "Olivos", "Los Olivos"] },
] as const;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/^sede\s+(de\s+)?/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function branchIdentity(value: string) {
  const cleanName = value.trim().replace(/^sede\s+(de\s+)?/i, "").trim();
  const key = normalize(cleanName);
  const compactKey = key.replace(/[^a-z0-9]/g, "");
  const core = coreBranches.find((branch) =>
    branch.aliases.some((alias) => {
      const normalizedAlias = normalize(alias);
      return normalizedAlias === key || normalizedAlias.replace(/[^a-z0-9]/g, "") === compactKey;
    }),
  );
  const legacyCode = legacyBranchCodes[key];
  return core || {
    code: legacyCode || cleanName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase() || "GEN",
    name: cleanName || "General",
    aliases: [] as readonly string[],
  };
}

export const canonicalBranchCode = (value: string) => branchIdentity(value).code;

let coreBranchesReady: Promise<void> | null = null;

export async function ensureCoreBranches() {
  coreBranchesReady ??= (async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(81724031)::text`;
      for (const branch of coreBranches) {
        await tx.branch.upsert({
          where: { code: branch.code },
          update: {},
          create: { code: branch.code, name: branch.name, active: true },
        });
      }

      for (const alias of duplicateBranches) {
        const target = await tx.branch.findUnique({ where: { code: alias.target }, select: { id: true } });
        if (!target) continue;
        const duplicates = await tx.branch.findMany({
          where: {
            id: { not: target.id },
            OR: [
              { code: { in: [...alias.codes] } },
              { name: { in: [...alias.names], mode: "insensitive" } },
            ],
          },
          select: { id: true },
        });

        for (const duplicate of duplicates) {
          const sourceUsers = await tx.user.findMany({
            where: { branchId: duplicate.id },
            select: { id: true, moduleNumber: true, active: true },
            orderBy: { id: "asc" },
          });
          const targetUsers = await tx.user.findMany({
            where: { branchId: target.id, active: true, moduleNumber: { not: null } },
            select: { moduleNumber: true },
          });
          const occupiedModules = new Set(targetUsers.map((user) => user.moduleNumber));
          for (const sourceUser of sourceUsers) {
            const moduleConflict = sourceUser.active && sourceUser.moduleNumber !== null && occupiedModules.has(sourceUser.moduleNumber);
            await tx.user.update({
              where: { id: sourceUser.id },
              data: {
                branchId: target.id,
                ...(moduleConflict ? { moduleNumber: null, availability: WorkerAvailability.PAUSED } : {}),
              },
            });
            if (sourceUser.active && sourceUser.moduleNumber !== null && !moduleConflict) occupiedModules.add(sourceUser.moduleNumber);
          }

          const sourceRoom = await tx.largeRoom.findUnique({ where: { branchId: duplicate.id } });
          const targetRoom = await tx.largeRoom.findUnique({ where: { branchId: target.id } });
          if (sourceRoom && targetRoom) {
            await tx.ticket.updateMany({ where: { largeRoomId: sourceRoom.id }, data: { largeRoomId: targetRoom.id } });
            if (sourceRoom.active && !targetRoom.active) {
              await tx.largeRoom.update({
                where: { id: targetRoom.id },
                data: { active: true, workerId: sourceRoom.workerId, capacity: Math.max(sourceRoom.capacity, targetRoom.capacity) },
              });
            } else if (sourceRoom.active && targetRoom.active && sourceRoom.workerId && sourceRoom.workerId !== targetRoom.workerId) {
              await tx.user.updateMany({ where: { id: sourceRoom.workerId }, data: { availability: WorkerAvailability.PAUSED } });
            }
            await tx.largeRoom.delete({ where: { id: sourceRoom.id } });
          } else if (sourceRoom) {
            await tx.largeRoom.update({ where: { id: sourceRoom.id }, data: { branchId: target.id } });
          }

          await tx.ticket.updateMany({ where: { branchId: duplicate.id }, data: { branchId: target.id } });
          await tx.branch.delete({ where: { id: duplicate.id } });
        }
      }
    });
  })().catch((error) => {
    coreBranchesReady = null;
    throw error;
  });

  return coreBranchesReady;
}

export async function findOrCreateBranch(value: string) {
  const identity = branchIdentity(value);
  const core = coreBranches.some((branch) => branch.code === identity.code);
  if (core) {
    return prisma.branch.upsert({
      where: { code: identity.code },
      update: {},
      create: { code: identity.code, name: identity.name, active: true },
    });
  }

  return prisma.branch.findFirst({
    where: { OR: [{ name: { equals: identity.name, mode: "insensitive" } }, { code: identity.code }] },
  }).then((existing) => existing || prisma.branch.create({
    data: { name: identity.name, code: identity.code, active: true },
  }));
}
