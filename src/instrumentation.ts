export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_WORKER === "true") return;
  const { startWorker } = await import("./server/jobs/worker");
  startWorker();
}
