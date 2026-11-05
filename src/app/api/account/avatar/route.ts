import { apiError, withUser } from "@/server/http/api";
import { BodyTooLargeError, readBodyLimited } from "@/server/http/body";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { prisma } from "@/server/db";
import { processAvatar, AvatarError } from "@/server/account/avatar";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Etwas Luft für den Rahmen des Formulars um die Datei.
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;
const TOO_LARGE = "Das Bild darf höchstens 5 MB gross sein.";

export const GET = withUser(async ({ user }) => {
  const avatar = await prisma.userAvatar.findUnique({ where: { userId: user.id } });
  if (!avatar) return apiError(404, "not_found", "Kein Profilbild vorhanden.");
  return new Response(new Uint8Array(avatar.data), {
    headers: {
      "Content-Type": avatar.mimeType,
      // Das Bild ist privat, darf aber im Browser des Besitzers bleiben.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export const POST = withUser(
  async ({ user, request }) => {
    let form: FormData | null;
    try {
      const body = await readBodyLimited(request, MAX_REQUEST_BYTES);
      const contentType = request.headers.get("content-type") ?? "";
      form = await new Response(body, { headers: { "Content-Type": contentType } }).formData().catch(() => null);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return apiError(413, "too_large", TOO_LARGE);
      throw error;
    }

    const file = form?.get("avatar");
    if (!(file instanceof File)) return apiError(400, "invalid_input", "Wähle ein Bild aus.");
    if (file.size > MAX_FILE_BYTES) return apiError(413, "too_large", TOO_LARGE);

    try {
      const data = await processAvatar(Buffer.from(await file.arrayBuffer()));
      const image = `/api/account/avatar?v=${Date.now()}`;
      await prisma.$transaction([
        prisma.userAvatar.upsert({
          where: { userId: user.id },
          create: { userId: user.id, data, mimeType: "image/webp" },
          update: { data, mimeType: "image/webp" },
        }),
        prisma.user.update({ where: { id: user.id }, data: { image } }),
      ]);
      return { image };
    } catch (error) {
      if (error instanceof AvatarError) return apiError(400, "invalid_image", error.message);
      throw error;
    }
  },
  { rateLimit: RATE_LIMITS.avatar },
);

export const DELETE = withUser(async ({ user }) => {
  await prisma.$transaction([
    prisma.userAvatar.deleteMany({ where: { userId: user.id } }),
    prisma.user.update({ where: { id: user.id }, data: { image: null } }),
  ]);
  return { ok: true };
});
