"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AIGenerationError, generateEmailDraft } from "@/lib/ai/generate";
import { dispatchEmail } from "@/lib/email/dispatch";
import { listStages, requireUser, requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, Contact, ContactNote, Email, EmailDraft } from "@/lib/types";

const Kind = z.enum(["first_contact", "soft_follow_up", "case_study", "closing_call"]);
const Draft = z.object({ subject: z.string().max(300), body: z.string().max(20000) });

const GenerateInput = z.object({
  slug: z.string(),
  contactId: z.uuid(),
  kind: Kind,
  revision: z.object({ draft: Draft, feedback: z.string().trim().min(1).max(1000) }).optional(),
});

/**
 * Genera (o rigenera con un'indicazione) la bozza per un contatto.
 * Il contesto viene sempre riletto dal database lato server: dal client
 * arrivano soltanto identificativi, mai i dati su cui costruire il prompt.
 */
export async function generateDraft(input: z.input<typeof GenerateInput>): Promise<ActionResult<EmailDraft>> {
  const parsed = GenerateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Richiesta non valida." };
  const { slug, contactId, kind, revision } = parsed.data;

  const user = await requireUser();
  const { workspace } = await requireWorkspace(slug);
  const supabase = await createClient();

  const [{ data: contact }, { data: notes }, { data: emails }, { data: profile }, stages] = await Promise.all([
    supabase.from("contacts").select("*").eq("workspace_id", workspace.id).eq("id", contactId).maybeSingle<Contact>(),
    supabase
      .from("contact_notes")
      .select("id, contact_id, body, created_at")
      .eq("workspace_id", workspace.id)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<ContactNote[]>(),
    supabase
      .from("emails")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("contact_id", contactId)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(10)
      .returns<Email[]>(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle<{ full_name: string | null }>(),
    listStages(workspace.id),
  ]);

  if (!contact) return { ok: false, error: "Contatto non trovato." };
  const stage = stages.find((s) => s.id === contact.stage_id);
  if (!stage) return { ok: false, error: "Fase della pipeline non trovata." };

  try {
    const draft = await generateEmailDraft(
      {
        workspace,
        senderName: profile?.full_name ?? null,
        contact,
        stage,
        notes: notes ?? [],
        emails: emails ?? [],
        kind,
        now: new Date(),
      },
      revision,
    );
    return { ok: true, data: draft };
  } catch (error) {
    if (error instanceof AIGenerationError) return { ok: false, error: error.message };
    console.error("Generazione bozza non riuscita", error);
    return { ok: false, error: "Generazione non riuscita. Riprova." };
  }
}

const SendInput = z.object({
  slug: z.string(),
  contactId: z.uuid(),
  kind: z.union([Kind, z.literal("custom")]),
  subject: z.string().trim().min(1, "Manca l'oggetto.").max(300),
  body: z.string().trim().min(1, "Il testo è vuoto.").max(20000),
  aiGenerated: z.boolean(),
  /** null: invio immediato. */
  scheduledAt: z.iso.datetime({ offset: true }).nullable(),
  /** Fase in cui spostare il contatto a email inviata; null: resta dov'è. */
  nextStageId: z.uuid().nullable(),
  /** Data del promemoria di follow-up; null: nessun promemoria. */
  followUpAt: z.iso.datetime({ offset: true }).nullable(),
});

export async function sendEmail(
  input: z.input<typeof SendInput>,
): Promise<ActionResult<{ status: "sent" | "scheduled" }>> {
  const parsed = SendInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;

  if (v.scheduledAt && new Date(v.scheduledAt).getTime() < Date.now() + 60_000) {
    return { ok: false, error: "L'orario di invio programmato deve essere nel futuro." };
  }

  const user = await requireUser();
  const { workspace } = await requireWorkspace(v.slug);
  const supabase = await createClient();

  const [{ data: contact }, { count: configured }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, email")
      .eq("workspace_id", workspace.id)
      .eq("id", v.contactId)
      .maybeSingle<{ id: string; email: string | null }>(),
    supabase
      .from("workspace_email_settings")
      .select("workspace_id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id),
  ]);
  if (!contact) return { ok: false, error: "Contatto non trovato." };
  if (!contact.email) return { ok: false, error: "Il contatto non ha un indirizzo email." };
  if (!configured) {
    return { ok: false, error: "Configura l'invio email nelle impostazioni dell'azienda prima di spedire." };
  }

  const { data: email, error } = await supabase
    .from("emails")
    .insert({
      workspace_id: workspace.id,
      contact_id: contact.id,
      kind: v.kind,
      status: v.scheduledAt ? "scheduled" : "sending",
      subject: v.subject,
      body: v.body,
      to_email: contact.email,
      ai_generated: v.aiGenerated,
      scheduled_at: v.scheduledAt,
      next_stage_id: v.nextStageId,
      next_action: v.followUpAt ? "Follow-up dopo l'ultima email" : null,
      next_action_at: v.followUpAt,
      created_by: user.id,
    })
    .select("id, workspace_id, to_email, subject, body")
    .single<{ id: string; workspace_id: string; to_email: string; subject: string; body: string }>();
  if (error || !email) return { ok: false, error: "Non è stato possibile registrare l'email. Riprova." };

  const path = `/w/${v.slug}`;
  if (v.scheduledAt) {
    revalidatePath(path, "layout");
    return { ok: true, data: { status: "scheduled" } };
  }

  const result = await dispatchEmail(supabase, email);
  revalidatePath(path, "layout");
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { status: "sent" } };
}

export async function cancelScheduledEmail(input: { slug: string; emailId: string }): Promise<ActionResult> {
  const parsed = z.object({ slug: z.string(), emailId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Richiesta non valida." };

  const { workspace } = await requireWorkspace(parsed.data.slug);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("emails")
    .update({ status: "cancelled" })
    .eq("workspace_id", workspace.id)
    .eq("id", parsed.data.emailId)
    .eq("status", "scheduled")
    .select("id");
  if (error || !data?.length) return { ok: false, error: "L'email non è più annullabile." };

  revalidatePath(`/w/${parsed.data.slug}`, "layout");
  return { ok: true };
}
