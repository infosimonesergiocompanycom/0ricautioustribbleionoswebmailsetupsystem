"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { encryptSecret } from "@/lib/crypto";
import { requireUser, requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const CreateWorkspace = z.object({
  name: z.string().trim().min(1, "Inserisci il nome dell'azienda.").max(120),
  industry: optionalText(120),
  website: optionalText(200),
  description: optionalText(4000),
});

export interface FormState {
  error?: string;
  saved?: boolean;
}

export async function createWorkspace(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const parsed = CreateWorkspace.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_workspace", {
      p_name: parsed.data.name,
      p_industry: parsed.data.industry,
      p_website: parsed.data.website,
      p_description: parsed.data.description,
    })
    .single<{ slug: string }>();
  if (error || !data) return { error: "Non è stato possibile creare l'azienda. Riprova." };

  revalidatePath("/", "layout");
  redirect(`/w/${data.slug}/settings?welcome=1`);
}

const BrandProfile = z.object({
  slug: z.string(),
  name: z.string().trim().min(1, "Il nome è obbligatorio.").max(120),
  industry: optionalText(120),
  website: optionalText(200),
  description: optionalText(4000),
  tone_of_voice: optionalText(4000),
  email_examples: optionalText(12000),
  signature: optionalText(1000),
  language: z.enum(["it", "en", "fr"]),
});

export async function updateBrandProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = BrandProfile.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { slug, ...values } = parsed.data;

  const { workspace, role } = await requireWorkspace(slug);
  if (role === "member") return { error: "Solo owner e admin possono modificare il profilo aziendale." };

  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").update(values).eq("id", workspace.id);
  if (error) return { error: "Salvataggio non riuscito. Riprova." };

  revalidatePath(`/w/${slug}`, "layout");
  return { saved: true };
}

const EmailSettingsInput = z
  .object({
    slug: z.string(),
    provider: z.enum(["resend", "sendgrid", "smtp"]),
    from_name: z.string().trim().min(1, "Indica il nome del mittente.").max(120),
    from_email: z.email("Indirizzo mittente non valido."),
    reply_to: z.union([z.literal(""), z.email("Indirizzo di risposta non valido.")]),
    smtp_host: optionalText(200),
    smtp_port: z.union([z.literal(""), z.coerce.number().int().min(1).max(65535)]),
    smtp_user: optionalText(200),
    // Vuoto in modifica: si conserva il segreto già salvato.
    secret: z.string().max(500),
  })
  .refine((v) => v.provider !== "smtp" || (v.smtp_host && v.smtp_port !== "" && v.smtp_user), {
    message: "Per SMTP servono host, porta e utente.",
  });

export async function updateEmailSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = EmailSettingsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { slug, secret, ...v } = parsed.data;

  const { workspace, role } = await requireWorkspace(slug);
  if (role === "member") return { error: "Solo owner e admin possono modificare la configurazione email." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("workspace_email_settings")
    .select("secret_ciphertext")
    .eq("workspace_id", workspace.id)
    .maybeSingle<{ secret_ciphertext: string | null }>();

  if (!secret && !existing?.secret_ciphertext) {
    return { error: v.provider === "smtp" ? "Inserisci la password SMTP." : "Inserisci la chiave API." };
  }

  let secret_ciphertext = existing?.secret_ciphertext ?? null;
  if (secret) {
    try {
      secret_ciphertext = encryptSecret(secret);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Cifratura non riuscita." };
    }
  }

  const isSmtp = v.provider === "smtp";
  const { error } = await supabase.from("workspace_email_settings").upsert({
    workspace_id: workspace.id,
    provider: v.provider,
    from_name: v.from_name,
    from_email: v.from_email,
    reply_to: v.reply_to || null,
    smtp_host: isSmtp ? v.smtp_host : null,
    smtp_port: isSmtp && v.smtp_port !== "" ? v.smtp_port : null,
    smtp_user: isSmtp ? v.smtp_user : null,
    secret_ciphertext,
  });
  if (error) return { error: "Salvataggio non riuscito. Riprova." };

  revalidatePath(`/w/${slug}/settings`);
  return { saved: true };
}
