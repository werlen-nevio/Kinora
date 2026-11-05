"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.signUp.email({
      name: String(form.get("name")).trim(),
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (failure) {
      setError(authErrorMessage(failure));
      setPending(false);
      return;
    }
    router.replace("/onboarding");
    router.refresh();
  };

  return (
    <>
      <h1 className="font-display text-title-md">Deine eigene Bibliothek</h1>
      <p className="mb-8 mt-2 text-fog">Merke dir Filme und Serien, verfolge, was du gesehen hast, und finde, was als Nächstes passt.</p>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="Anzeigename" name="name" autoComplete="name" required maxLength={60} />
        <Field label="E-Mail" name="email" type="email" autoComplete="email" required />
        <Field label="Passwort" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} hint="Mindestens 10 Zeichen." />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? "Konto wird erstellt" : "Konto erstellen"}
        </Button>
        <p className="pt-2 text-sm text-fog">
          Schon ein Konto?{" "}
          <Link href="/anmelden" className="text-screen hover:underline">
            Anmelden
          </Link>
        </p>
      </form>
    </>
  );
}
