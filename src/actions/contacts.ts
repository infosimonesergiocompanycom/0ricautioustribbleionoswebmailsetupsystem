"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listStages, requireUser, requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const NewContact = z.object({
  slug: z.string(),
  first_name: z.string().trim().min(1, "Il nome è obbligatorio.").max(80),
  last_name: optionalText(80),
  email: z.union([z.literal("").transform(() => null), z.email("Indirizzo email non valido.")]),
  phone: optionalText(40),
  company: optionalText(120),
  job_title: optionalText(120),
  source: optionalText(120),
  tags: z.string().max(400),
  stage_id: z.union([z.literal(""), z.uuid()]),
  note: optionalText(4000),
});

export interface ContactFormState {
  error?: string;
  createdId?: string;
}

export async function createContact(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const parsed = NewContact.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { slug, note, tags, stage_id, ...fields } = parsed.data;

  const user = await requireUser();
  const { workspace } = await requireWorkspace(slug);
  const stages = await listStages(workspace.id);
  const stage = stages.find((s) => s.id === stage_id) ?? stages[0];
  if (!stage) return { error: "Questa azienda non ha ancora fasi nella pipeline." };

  const supabase = await createClient();
  const { data: contact, error } = await supabase
    .from("contacts")
    .insert({
      ...fields,
      workspace_id: workspace.id,
      stage_id: stage.id,
      tags: [...new Set(tags.split(",").map((t) => t.trim()).filter(Boolean))],
      created_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error?.code === "23505") return { error: "Esiste già un contatto con questo indirizzo email." };
  if (error || !contact) return { error: "Salvataggio non riuscito. Riprova." };

  if (note) {
    await supabase
      .from("contact_notes")
      .insert({ workspace_id: workspace.id, contact_id: contact.id, body: note, created_by: user.id });
  }

  revalidatePath(`/w/${slug}`, "layout");
  return { createdId: contact.id };
}

export async function addNote(input: { slug: string; contactId: string; body: string }): Promise<ActionResult> {
  const parsed = z
    .object({ slug: z.string(), contactId: z.uuid(), body: z.string().trim().min(1).max(4000) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "La nota è vuota o troppo lunga." };

  const user = await requireUser();
  const { workspace } = await requireWorkspace(parsed.data.slug);
  const supabase = await createClient();
  const { error } = await supabase.from("contact_notes").insert({
    workspace_id: workspace.id,
    contact_id: parsed.data.contactId,
    body: parsed.data.body,
    created_by: user.id,
  });
  if (error) return { ok: false, error: "Nota non salvata. Riprova." };

  revalidatePath(`/w/${parsed.data.slug}/contacts/${parsed.data.contactId}`);
  return { ok: true };
}

export async function moveContact(input: { slug: string; contactId: string; stageId: string }): Promise<ActionResult> {
  const parsed = z.object({ slug: z.string(), contactId: z.uuid(), stageId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Richiesta non valida." };

  const { workspace } = await requireWorkspace(parsed.data.slug);
  const supabase = await createClient();
  // La FK composita (workspace_id, stage_id) rifiuta fasi di altri workspace.
  const { data, error } = await supabase
    .from("contacts")
    .update({ stage_id: parsed.data.stageId })
    .eq("workspace_id", workspace.id)
    .eq("id", parsed.data.contactId)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Spostamento non riuscito." };

  revalidatePath(`/w/${parsed.data.slug}`, "layout");
  return { ok: true };
}

export async function setNextAction(input: {
  slug: string;
  contactId: string;
  action: string;
  dueAt: string | null;
}): Promise<ActionResult> {
  const parsed = z
    .object({
      slug: z.string(),
      contactId: z.uuid(),
      action: z.string().trim().max(200),
      dueAt: z.iso.datetime({ offset: true }).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Richiesta non valida." };

  const { workspace } = await requireWorkspace(parsed.data.slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({
      next_action: parsed.data.dueAt ? parsed.data.action || "Ricontattare" : null,
      next_action_at: parsed.data.dueAt,
    })
    .eq("workspace_id", workspace.id)
    .eq("id", parsed.data.contactId);
  if (error) return { ok: false, error: "Promemoria non salvato." };

  revalidatePath(`/w/${parsed.data.slug}`, "layout");
  return { ok: true };
}
