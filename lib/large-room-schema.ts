import { prisma } from "@/lib/prisma";

// The production database URL is managed as a Vercel secret and cannot be
// pulled into local development. Bootstrap these additive tables/columns once
// per server instance, with a database advisory lock for concurrent cold starts.
let schemaReady: Promise<void> | null = null;

export function ensureLargeRoomSchema() {
  schemaReady ??= prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(834729104)::text`;
    await tx.$executeRaw`CREATE TABLE IF NOT EXISTS "LargeRoom" (
      "id" SERIAL NOT NULL,
      "branchId" INTEGER NOT NULL,
      "workerId" INTEGER,
      "active" BOOLEAN NOT NULL DEFAULT false,
      "capacity" INTEGER NOT NULL DEFAULT 10,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "LargeRoom_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "LargeRoom_branchId_key" UNIQUE ("branchId")
    )`;
    await tx.$executeRaw`ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "largeRoomId" INTEGER`;
    await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "Ticket_largeRoomId_status_idx" ON "Ticket"("largeRoomId", "status")`;
    await tx.$executeRaw`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LargeRoom_branchId_fkey') THEN
        ALTER TABLE "LargeRoom" ADD CONSTRAINT "LargeRoom_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LargeRoom_workerId_fkey') THEN
        ALTER TABLE "LargeRoom" ADD CONSTRAINT "LargeRoom_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_largeRoomId_fkey') THEN
        ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_largeRoomId_fkey" FOREIGN KEY ("largeRoomId") REFERENCES "LargeRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$`;
  }).then(() => undefined).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}
