import { prisma } from "@/server/db";
import { withUser } from "@/server/http/api";

export const GET = withUser(async ({ user }) => {
  const rows = await prisma.searchHistory.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { query: true },
  });
  return { queries: rows.map((row) => row.query) };
});

export const DELETE = withUser(async ({ user }) => {
  await prisma.searchHistory.deleteMany({ where: { userId: user.id } });
  return { ok: true };
});
