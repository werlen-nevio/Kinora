import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Anmelden" };

export default function SignInPage() {
  return (
    <>
      <h1 className="font-display text-title-md">Willkommen zurück</h1>
      <p className="mb-8 mt-2 text-fog">Melde dich an, um deine Bibliothek zu öffnen.</p>
      <Suspense>
        <SignInForm />
      </Suspense>
    </>
  );
}
