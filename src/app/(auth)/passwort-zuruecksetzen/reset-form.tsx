"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Field, FormError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <>
        <h1 className="font-display text-title-md">Dieser Link ist ungültig</h1>
        <p className="mt-3 text-fog">Fordere einen neuen Link an. Er gilt jeweils eine Stunde.</p>
        <Link href="/passwort-vergessen" className="mt-8 inline-block text-sm text-screen hover:underline">
          Neuen Link anfordern
        </Link>
      </>
    );
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.resetPassword({ token, newPassword: String(form.get("password")) });
    setPending(false);
    if (failure) {
      setError(authErrorMessage(failure));
      return;
    }
    toast.success("Passwort geändert. Melde dich jetzt damit an.");
    router.replace("/anmelden");
  };

  return (
    <>
      <h1 className="font-display text-title-md">Neues Passwort festlegen</h1>
      <p className="mb-8 mt-2 text-fog">Danach sind alle anderen Geräte abgemeldet.</p>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="Neues Passwort" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} hint="Mindestens 10 Zeichen." />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          Passwort ändern
        </Button>
      </form>
    </>
  );
}
