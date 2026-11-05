"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, FormError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: "/passwort-zuruecksetzen",
    });
    setPending(false);
    if (failure) setError(authErrorMessage(failure));
    else setSent(true);
  };

  if (sent) {
    return (
      <>
        <h1 className="font-display text-title-md">Prüfe dein Postfach</h1>
        <p className="mt-3 text-fog">Falls es zu dieser Adresse ein Konto gibt, ist ein Link unterwegs. Er gilt eine Stunde.</p>
        <Link href="/anmelden" className="mt-8 inline-block text-sm text-screen hover:underline">
          Zurück zur Anmeldung
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="font-display text-title-md">Passwort zurücksetzen</h1>
      <p className="mb-8 mt-2 text-fog">Du bekommst einen Link, mit dem du ein neues Passwort festlegst.</p>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="E-Mail" name="email" type="email" autoComplete="email" required />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          Link senden
        </Button>
        <Link href="/anmelden" className="block pt-2 text-sm text-fog hover:text-screen">
          Zurück zur Anmeldung
        </Link>
      </form>
    </>
  );
}
