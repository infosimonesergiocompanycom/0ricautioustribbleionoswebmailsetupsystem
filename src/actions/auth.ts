"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  message?: string;
}

const Credentials = z.object({
  email: z.email("Inserisci un indirizzo email valido."),
  password: z.string().min(8, "La password deve avere almeno 8 caratteri."),
});

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = Credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Email o password non corretti." };
  redirect("/");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = Credentials.extend({
    full_name: z.string().trim().min(1, "Inserisci il tuo nome.").max(120),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name },
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });
  if (error) return { error: "Registrazione non riuscita. Verifica i dati e riprova." };
  if (!data.session) {
    return { message: "Ti abbiamo inviato un'email: apri il link per confermare l'indirizzo e accedere." };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
