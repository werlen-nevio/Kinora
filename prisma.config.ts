import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // `prisma generate` braucht keine Datenbank, deshalb kein harter Fehler hier.
    url: process.env.DATABASE_URL ?? "postgresql://kinora:kinora@localhost:5432/kinora",
  },
});
