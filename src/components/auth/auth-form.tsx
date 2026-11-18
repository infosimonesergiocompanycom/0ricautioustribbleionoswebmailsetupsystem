"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthState } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const isSignup = mode === "signup";
  const [state, action, pending] = useActionState<AuthState, FormData>(isSignup ? signUp : signIn, {});

  return (
    <div>
      <h1 className="text-center text-3xl">{isSignup ? "Crea il tuo account" : "Bentornato"}</h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        {isSignup ? "Un solo account per tutte le tue aziende." : "Accedi per vedere chi ricontattare oggi."}
      </p>

      <form action={action} className="mt-10 space-y-5">
        {isSignup && (
          <div className="space-y-2">
            <Label htmlFor="full_name">Nome e cognome</Label>
            <Input id="full_name" name="full_name" autoComplete="name" required className="h-10" />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required className="h-10" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={8}
            required
            className="h-10"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        {state.message && (
          <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm">
            {state.message}
          </p>
        )}

        <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
          {pending ? "Un momento…" : isSignup ? "Crea account" : "Accedi"}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        {isSignup ? "Hai già un account? " : "Non hai un account? "}
        <Link href={isSignup ? "/login" : "/signup"} className="text-foreground underline underline-offset-4">
          {isSignup ? "Accedi" : "Registrati"}
        </Link>
      </p>
    </div>
  );
}
