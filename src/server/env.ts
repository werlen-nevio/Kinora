import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://kinora:kinora@localhost:5432/kinora"),
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  TRUSTED_ORIGINS: z.string().optional(),
  TMDB_READ_ACCESS_TOKEN: z.string().optional(),
  TMDB_API_BASE_URL: z.string().url().default("https://api.themoviedb.org/3"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Kinora <no-reply@localhost>"),
  LOG_RESET_LINKS: z.string().optional(),
  ALLOW_SIGNUP: z.string().optional(),
  SMTP_ALLOW_PLAINTEXT: z.string().optional(),
  DISABLE_WORKER: z.string().optional(),
  NODE_ENV: z.string().default("development"),
});

// Leere Werte aus einer ausgefüllten .env-Vorlage gelten als nicht gesetzt.
const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ""));

export const env = schema.parse(raw);

export const isProduction = env.NODE_ENV === "production";

export function allowedOrigins(): string[] {
  const extra = env.TRUSTED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
  return [new URL(env.BETTER_AUTH_URL).origin, ...extra];
}
