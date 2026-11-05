import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  "@": path.resolve(root, "src"),
  "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
};

const POSTGRES_PORT = 55433;
const TMDB_PORT = 54322;

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          // Alle Dateien teilen sich eine Datenbank und einen TMDB-Testserver.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? `postgresql://kinora:kinora@localhost:${POSTGRES_PORT}/kinora_test`,
            BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
            BETTER_AUTH_URL: "http://localhost:3999",
            TMDB_READ_ACCESS_TOKEN: "kinora-test-token",
            TMDB_API_BASE_URL: `http://localhost:${TMDB_PORT}/3`,
            NEXT_PUBLIC_TMDB_IMAGE_BASE_URL: `http://localhost:${TMDB_PORT}/t/p`,
            DISABLE_WORKER: "true",
          },
        },
      },
    ],
  },
});
