import { prisma } from "@/server/db";

// Für den Docker-Healthcheck; verrät nur, ob die Datenbank antwortet.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "database_unavailable" }, { status: 503 });
  }
}
