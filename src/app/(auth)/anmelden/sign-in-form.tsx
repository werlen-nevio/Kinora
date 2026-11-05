"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Field, FormError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { safeNextPath } from "@/lib/safe-path";

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (failure) {
      setError(authErrorMessage(failure));
      setPending(false);
      return;
    }
    router.replace(safeNextPath(params.get("weiter")));
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <FormError message={error} />
      <Field label="E-Mail" name="email" type="email" autoComplete="email" required />
      <Field label="Passwort" name="password" type="password" autoComplete="current-password" required />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? "Wird angemeldet" : "Anmelden"}
      </Button>
      <div className="flex justify-between gap-4 pt-2 text-sm text-fog">
        <Link href="/registrieren" className="hover:text-screen">
          Konto erstellen
        </Link>
        <Link href="/passwort-vergessen" className="hover:text-screen">
          Passwort vergessen?
        </Link>
      </div>
    </form>
  );
}
