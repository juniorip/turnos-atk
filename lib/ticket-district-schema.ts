import { prisma } from "@/lib/prisma";

let schemaReady: Promise<void> | null = null;

export function ensureTicketDistrictSchema() {
  schemaReady ??= prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(834729105)::text`;
    await tx.$executeRaw`ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "district" TEXT`;
  }).then(() => undefined).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}
