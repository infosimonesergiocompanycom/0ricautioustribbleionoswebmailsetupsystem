"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAutomationBatch, syncReplies, type BatchResult } from "@/lib/automation/engine";
import { requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export interface AutomationFormState {
  error?: string;
  saved?: boolean;
}

const Settings = z.object({
  slug: z.string(),
  automation_enabled: z.enum(["on"]).optional(),
  follow_up_after_days: z.coerce.number().int().min(1).max(60),
  max_follow_ups: z.coerce.number().int().min(0).max(5),
  daily_send_limit: z.coerce.number().int().min(1).max(1000),
});

export async function updateAutomationSettings(
  _prev: AutomationFormState,
  formData: FormData,
): Promise<AutomationFormState> {
  const parsed = Settings.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Controlla i valori inseriti." };
  const { slug, automation_enabled, ...values } = parsed.data;

  const { workspace, role } = await requireWorkspace(slug);
  if (role === "member") return { error: "Solo owner e admin possono modificare l'automazione." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ ...values, automation_enabled: automation_enabled === "on" })
    .eq("id", workspace.id);
  if (error) return { error: "Salvataggio non riuscito. Riprova." };

  revalidatePath(`/w/${slug}`, "layout");
  return { saved: true };
}

/** Lavora un gruppo di contatti. Il pannello la richiama finché resta qualcosa da inviare. */
export async function runAutomationNow(slug: string, single = false): Promise<ActionResult<BatchResult>> {
  const { workspace } = await requireWorkspace(slug);
  if (!workspace.automation_enabled) return { ok: false, error: "L'automazione è spenta: attivala nelle impostazioni." };

  const supabase = await createClient();
  const result = await runAutomationBatch(supabase, workspace, single ? 1 : undefined);
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, data: result };
}

export async function checkRepliesNow(slug: string): Promise<ActionResult> {
  const { workspace } = await requireWorkspace(slug);
  const supabase = await createClient();
  const error = await syncReplies(supabase, workspace, true);
  revalidatePath(`/w/${slug}`, "layout");
  return error ? { ok: false, error } : { ok: true };
}

export async function setAutomationPaused(input: {
  slug: string;
  contactId: string;
  paused: boolean;
}): Promise<ActionResult> {
  const parsed = z.object({ slug: z.string(), contactId: z.uuid(), paused: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Richiesta non valida." };

  const { workspace } = await requireWorkspace(parsed.data.slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ automation_paused: parsed.data.paused })
    .eq("workspace_id", workspace.id)
    .eq("id", parsed.data.contactId);
  if (error) return { ok: false, error: "Modifica non salvata." };

  revalidatePath(`/w/${parsed.data.slug}`, "layout");
  return { ok: true };
}

export async function deleteContact(input: { slug: string; contactId: string }): Promise<ActionResult> {
  const parsed = z.object({ slug: z.string(), contactId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Richiesta non valida." };

  const { workspace } = await requireWorkspace(parsed.data.slug);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .delete()
    .eq("workspace_id", workspace.id)
    .eq("id", parsed.data.contactId)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Eliminazione non riuscita." };

  revalidatePath(`/w/${parsed.data.slug}`, "layout");
  redirect(`/w/${parsed.data.slug}/contacts`);
}
