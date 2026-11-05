import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as { kinoraPrisma?: PrismaClient };

function createClient() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
}

// Hot Reload würde sonst bei jeder Änderung einen neuen Connection Pool öffnen.
export const prisma = globalForPrisma.kinoraPrisma ?? createClient();

if (env.NODE_ENV !== "production") globalForPrisma.kinoraPrisma = prisma;
