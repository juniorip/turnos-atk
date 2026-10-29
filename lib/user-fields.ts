import type { Prisma } from "@prisma/client";

// Never serialize credentials when returning a User to the browser.
export const publicUserFields = {
  id: true, name: true, username: true, dni: true, role: true,
  active: true, availability: true, lastActiveAt: true,
  moduleNumber: true, branchId: true, createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect;
