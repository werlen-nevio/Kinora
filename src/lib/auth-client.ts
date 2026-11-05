import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-Mail oder Passwort stimmt nicht.",
  USER_ALREADY_EXISTS: "Zu dieser E-Mail gibt es schon ein Konto. Melde dich an oder setze das Passwort zurück.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Zu dieser E-Mail gibt es schon ein Konto. Melde dich an oder setze das Passwort zurück.",
  PASSWORD_TOO_SHORT: "Das Passwort braucht mindestens 10 Zeichen.",
  PASSWORD_TOO_LONG: "Das Passwort darf höchstens 128 Zeichen lang sein.",
  INVALID_EMAIL: "Das sieht nicht nach einer gültigen E-Mail-Adresse aus.",
  INVALID_PASSWORD: "Das Passwort stimmt nicht.",
  INVALID_TOKEN: "Dieser Link ist abgelaufen. Fordere einen neuen an.",
  EMAIL_PASSWORD_SIGN_UP_DISABLED: "Auf dieser Instanz lassen sich keine neuen Konten anlegen.",
  SESSION_EXPIRED: "Melde dich zur Sicherheit neu an und versuche es dann noch einmal.",
};

export function authErrorMessage(error: { code?: string; status?: number; message?: string } | null | undefined): string {
  if (error?.status === 429) return "Zu viele Versuche. Warte einen Moment und versuche es noch einmal.";
  return (error?.code && MESSAGES[error.code]) || "Das hat nicht geklappt. Versuche es noch einmal.";
}
