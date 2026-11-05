import "server-only";
import nodemailer from "nodemailer";
import { env, isProduction } from "../env";

function transport() {
  if (!env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    // Sonst könnte ein Angreifer STARTTLS unterdrücken und den Link mitlesen.
    requireTLS: env.SMTP_PORT !== 465 && env.SMTP_ALLOW_PLAINTEXT !== "true",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
}

export async function sendPasswordResetMail(to: string, url: string) {
  const mailer = transport();
  if (!mailer) {
    // Ein Link im Log ist ein Zugang zum Konto. In Produktion deshalb nur auf ausdrücklichen Wunsch.
    if (!isProduction || env.LOG_RESET_LINKS === "true") {
      console.log(`[mail] Link zum Zurücksetzen für ${to}: ${url}`);
    } else {
      console.warn("[mail] Kein SMTP konfiguriert. Der Link zum Zurücksetzen konnte nicht versendet werden.");
    }
    return;
  }
  await mailer.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: "Passwort für Kinora zurücksetzen",
    // Bewusst ohne Anzeigenamen: Den könnte jemand beim Registrieren frei wählen und so
    // eigenen Text in eine echte Mail an eine fremde Adresse bringen.
    text: `Hallo\n\nÜber diesen Link setzt du dein Passwort zurück. Er gilt eine Stunde:\n${url}\n\nHast du das nicht angefordert, kannst du diese E-Mail ignorieren.`,
    html: `<p>Hallo</p><p><a href="${encodeURI(url)}">Passwort zurücksetzen</a>. Der Link gilt eine Stunde.</p><p>Hast du das nicht angefordert, kannst du diese E-Mail ignorieren.</p>`,
  });
}
