import { auth } from "@/server/auth/auth";

export const ORIGIN = "http://localhost:3999";

let counter = 0;

export function uniqueEmail(prefix = "user") {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

export const PASSWORD = "ein-langes-testpasswort";

export function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Jede Anfrage kommt von einer eigenen Adresse; sonst greift das Rate Limiting zwischen Tests. */
function nextTestIp() {
  counter += 1;
  return `198.51.${Math.floor(counter / 250)}.${(counter % 250) + 1}`;
}

function authRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "x-forwarded-for": nextTestIp(), ...headers },
    body: JSON.stringify(body),
  });
}

export function authCall(path: string, body: unknown, headers?: Record<string, string>) {
  return auth.handler(authRequest(path, body, headers));
}

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

export async function signUp(name = "Testperson", email = uniqueEmail()): Promise<TestUser> {
  const response = await authCall("/sign-up/email", { name, email, password: PASSWORD });
  if (!response.ok) throw new Error(`Registrierung fehlgeschlagen: ${response.status} ${await response.text()}`);
  const data = (await response.json()) as { user: { id: string } };
  return { id: data.user.id, email, cookie: cookieFrom(response) };
}

type Handler = (request: Request) => Promise<Response>;

/** Ruft einen Route Handler wie ein Browser auf: mit Cookie und Origin. */
export async function call<T = unknown>(
  handler: Handler,
  options: { user?: TestUser; method?: string; body?: unknown; path?: string; origin?: string | null } = {},
): Promise<{ status: number; data: T }> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.user) headers.Cookie = options.user.cookie;
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.Origin = origin;
  const response = await handler(
    new Request(`${ORIGIN}${options.path ?? "/api/test"}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
}
