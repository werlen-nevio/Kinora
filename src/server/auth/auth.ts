import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "../db";
import { allowedOrigins, env, isProduction } from "../env";
import { sendPasswordResetMail } from "../mail/mailer";

const DAY = 24 * 3600;
const MAX_NAME_LENGTH = 60;

// Das Formular begrenzt den Namen nur im Browser; massgeblich ist der Server.
function cleanName(name: string) {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

export const auth = betterAuth({
  appName: "Kinora",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: allowedOrigins(),
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    disableSignUp: env.ALLOW_SIGNUP === "false",
    requireEmailVerification: false,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 3600,
    // Nach dem Zurücksetzen gelten alle anderen Geräte als abgemeldet.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Nicht warten: Die Antwortzeit darf nicht verraten, ob ein Konto existiert.
      void sendPasswordResetMail(user.email, url).catch((error) => {
        console.error("[mail] Versand fehlgeschlagen:", error);
      });
    },
  },
  session: {
    expiresIn: 30 * DAY,
    updateAge: 1 * DAY,
    freshAge: 1 * DAY,
  },
  user: {
    deleteUser: { enabled: true },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-up/email": { window: 3600, max: 10 },
      "/request-password-reset": { window: 3600, max: 5 },
      "/reset-password": { window: 3600, max: 10 },
      "/change-password": { window: 3600, max: 10 },
      "/delete-user": { window: 3600, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: isProduction && env.BETTER_AUTH_URL.startsWith("https://"),
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    database: { generateId: () => crypto.randomUUID() },
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, name: cleanName(user.name) } }),
        after: async (user) => {
          await prisma.userPreference.create({ data: { userId: user.id } });
          await prisma.recommendationState.create({ data: { userId: user.id } });
        },
      },
      update: {
        before: async (user) => ({ data: typeof user.name === "string" ? { ...user, name: cleanName(user.name) } : user }),
      },
    },
  },
  // nextCookies muss das letzte Plugin bleiben.
  plugins: [nextCookies()],
});
