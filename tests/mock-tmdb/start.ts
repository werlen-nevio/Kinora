import { startMockTmdb } from "./server";

const port = Number(process.argv[2] ?? process.env.MOCK_TMDB_PORT ?? 54321);

void startMockTmdb(port).then(() => {
  console.log(`[mock-tmdb] läuft auf http://localhost:${port}`);
});
