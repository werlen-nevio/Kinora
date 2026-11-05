import "server-only";
import { cache } from "react";
import { DEFAULT_LANGUAGE, DEFAULT_REGION } from "@/lib/locale";
import { prisma } from "./db";

export interface UserContext {
  language: string;
  region: string;
  showWhy: boolean;
  onboardingCompleted: boolean;
}

export const getUserContext = cache(async (userId: string): Promise<UserContext> => {
  const preferences = await prisma.userPreference.findUnique({ where: { userId } });
  return {
    language: preferences?.language ?? DEFAULT_LANGUAGE,
    region: preferences?.region ?? DEFAULT_REGION,
    showWhy: preferences?.showRecommendationWhy ?? true,
    onboardingCompleted: preferences?.onboardingCompletedAt != null,
  };
});
