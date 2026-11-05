import { prisma } from "@/server/db";
import { withUser } from "@/server/http/api";
import { markRecommendationsDirty, recordInteraction } from "@/server/library/service";

export const POST = withUser(async ({ user }) => {
  const now = new Date();
  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, onboardingCompletedAt: now },
    update: { onboardingCompletedAt: now },
  });
  await recordInteraction(user.id, "ONBOARDING_COMPLETED");
  await markRecommendationsDirty(user.id);
  return { ok: true };
});
