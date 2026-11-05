import type { Metadata } from "next";
import { KindHub } from "@/components/browse/kind-hub";
import { requireUser } from "@/server/auth/session";
import { getUserContext } from "@/server/user";

export const metadata: Metadata = { title: "Filme" };

export default async function MoviesPage() {
  const user = await requireUser();
  const { language } = await getUserContext(user.id);
  return <KindHub kind="movie" title="Filme" language={language} />;
}
