import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** Für Seiten im geschützten Bereich. Autorisiert, nicht nur eine UI-Weiche. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/anmelden");
  return session.user;
}

export type SessionUser = Awaited<ReturnType<typeof requireUser>>;
