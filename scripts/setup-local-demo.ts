import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { PrismaClient, UserRole, WorkerAvailability } from "@prisma/client";

const connection = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production" || !connection) {
  throw new Error("La configuración demo solo se permite con una base de datos local.");
}

const databaseUrl = new URL(connection);
if (!["127.0.0.1", "localhost"].includes(databaseUrl.hostname) || databaseUrl.port !== "5433") {
  throw new Error("Seguridad: este seed solo puede usarse con PostgreSQL local en el puerto 5433.");
}

const prisma = new PrismaClient();

async function main() {
  const branch = await prisma.branch.upsert({
    where: { code: "LIN" },
    update: { active: true },
    create: { name: "Lince", code: "LIN", address: "Sede de prueba" },
  });
  const services = await Promise.all(
    ["Registro", "Consulta", "Efectivización", "Pago de deuda", "Plan de retención"].map((name) =>
      prisma.service.upsert({ where: { name }, update: { active: true }, create: { name } }),
    ),
  );
  await Promise.all(
    ["BCP", "BBVA", "Interbank", "Scotiabank", "BanBif", "CMR", "IO", "Tarjeta Comercial"].map((name) =>
      prisma.bank.upsert({ where: { name }, update: { active: true }, create: { name } }),
    ),
  );

  const testPasswordHash = await bcrypt.hash("Demo123!", 10);
  const localAdminPasswordHash = await bcrypt.hash("DemoAdmin123!", 10);
  await prisma.user.upsert({
    where: { username: "admin-local" },
    update: { name: "Administrador local de prueba", passwordHash: localAdminPasswordHash, role: UserRole.ADMIN, active: true, branchId: null, moduleNumber: null },
    create: { name: "Administrador local de prueba", username: "admin-local", passwordHash: localAdminPasswordHash, role: UserRole.ADMIN, active: true },
  });
  for (let index = 1; index <= 6; index++) {
    const username = index === 1 ? "prueba" : `demo-asesor-${index}`;
    const passwordHash = index === 1 ? testPasswordHash : await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const user = await prisma.user.upsert({
      where: { username },
      update: {
        name: `Colaborador de prueba ${index}`,
        role: UserRole.WORKER,
        active: true,
        branchId: branch.id,
        moduleNumber: index,
        availability: WorkerAvailability.AVAILABLE,
      },
      create: {
        name: `Colaborador de prueba ${index}`,
        username,
        passwordHash,
        role: UserRole.WORKER,
        active: true,
        branchId: branch.id,
        moduleNumber: index,
        availability: WorkerAvailability.AVAILABLE,
      },
    });
    for (const service of services) {
      await prisma.workerService.upsert({
        where: { userId_serviceId: { userId: user.id, serviceId: service.id } },
        update: {},
        create: { userId: user.id, serviceId: service.id },
      });
    }
  }
  console.log("Base local demo lista: admin-local / DemoAdmin123!; asesor prueba / Demo123! (módulo 1).");
}

main().finally(() => prisma.$disconnect());
