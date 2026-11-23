"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listStages, requireUser, requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

const text = (max: number) => z.string().trim().max(max).nullable();

const Row = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: text(80),
  email: z.email().nullable(),
  phone: text(40),
  company: text(120),
  job_title: text(120),
  source: text(120),
  tags: z.array(z.string().trim().min(1).max(60)).max(20),
  created_at: z.iso.datetime({ offset: true }).nullable(),
  note: text(4000),
});

const Input = z.object({
  slug: z.string(),
  // Il client invia a blocchi: il limite tiene ogni richiesta sotto la soglia delle server action.
  rows: z.array(Row).min(1).max(250),
});

export interface ImportOutcome {
  created: number;
  /** Righe saltate perché l'email è già presente in questa azienda. */
  alreadyPresent: number;
}

export async function importContacts(input: z.input<typeof Input>): Promise<ActionResult<ImportOutcome>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Dati non validi alla riga ${Number(issue.path[1] ?? 0) + 1}: ${issue.message}` };
  }
  const { slug, rows } = parsed.data;

  const user = await requireUser();
  const { workspace } = await requireWorkspace(slug);
  const stages = await listStages(workspace.id);
  const stage = stages[0];
  if (!stage) return { ok: false, error: "Questa azienda non ha ancora fasi nella pipeline." };

  const supabase = await createClient();
  const emails = rows.map((r) => r.email).filter((e): e is string => e !== null);
  const present = new Set<string>();
  if (emails.length > 0) {
    const { data, error } = await supabase
      .from("contacts")
      .select("email")
      .eq("workspace_id", workspace.id)
      .in("email", emails);
    if (error) return { ok: false, error: "Controllo dei duplicati non riuscito. Riprova." };
    for (const c of data ?? []) if (c.email) present.add(String(c.email).toLowerCase());
  }

  const fresh = rows.filter((r) => !r.email || !present.has(r.email.toLowerCase()));
  if (fresh.length === 0) return { ok: true, data: { created: 0, alreadyPresent: rows.length } };

  const { data: inserted, error } = await supabase
    .from("contacts")
    .insert(
      fresh.map((r) => ({
        workspace_id: workspace.id,
        stage_id: stage.id,
        first_name: r.first_name,
        last_name: r.last_name || null,
        email: r.email,
        phone: r.phone || null,
        company: r.company || null,
        job_title: r.job_title || null,
        source: r.source || null,
        tags: [...new Set(r.tags)],
        created_by: user.id,
        ...(r.created_at ? { created_at: r.created_at } : {}),
      })),
    )
    .select("id");
  if (error || !inserted || inserted.length !== fresh.length) {
    return { ok: false, error: "Importazione non riuscita: nessun contatto di questo blocco è stato salvato." };
  }

  // PostgREST restituisce le righe nell'ordine di inserimento.
  const notes = fresh
    .map((r, i) => ({ note: r.note, contact_id: inserted[i].id as string }))
    .filter((n): n is { note: string; contact_id: string } => Boolean(n.note))
    .map((n) => ({ workspace_id: workspace.id, contact_id: n.contact_id, body: n.note, created_by: user.id }));
  if (notes.length > 0) {
    const { error: noteError } = await supabase.from("contact_notes").insert(notes);
    if (noteError) {
      return { ok: false, error: "Contatti salvati, ma le note non sono state registrate. Non ripetere l'importazione." };
    }
  }

  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, data: { created: fresh.length, alreadyPresent: rows.length - fresh.length } };
}
