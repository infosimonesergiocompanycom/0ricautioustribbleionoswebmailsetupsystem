import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIGenerationError, aiConfigured, generateEmailDraft } from "@/lib/ai/generate";
import { dispatchEmail } from "@/lib/email/dispatch";
import type { Contact, ContactNote, Email, EmailSettings, PipelineStage, Workspace } from "@/lib/types";
import { canReadReplies, fetchReplies } from "./replies";

const CONCURRENCY = 4;
const CLAIM_TTL_MS = 15 * 60_000;
const REPLY_CHECK_INTERVAL_MS = 10 * 60_000;
/** I solleciti partono solo se la casella è stata letta di recente. */
const REPLY_CHECK_MAX_AGE_MS = 24 * 3_600_000;

export interface AutomationOverview {
  /** Contatti che non hanno ancora ricevuto nulla. */
  awaitingFirst: number;
  /** Solleciti che partirebbero adesso. */
  followUpsDue: number;
  /** In sequenza, ma il prossimo sollecito non è ancora maturo. */
  waiting: number;
  replied: number;
  /** Sequenza conclusa senza risposta. */
  exhausted: number;
  sentToday: number;
  followUpsBlocked: string | null;
}

export interface BatchResult {
  sent: number;
  /** Contatti ancora da lavorare in questo momento. */
  remaining: number;
  error: string | null;
}

interface Scope {
  supabase: SupabaseClient;
  workspace: Workspace;
  settings: EmailSettings | null;
  openStageIds: string[];
  stages: PipelineStage[];
}

async function loadScope(supabase: SupabaseClient, workspace: Workspace): Promise<Scope> {
  const [{ data: settings }, { data: stages }] = await Promise.all([
    supabase.from("workspace_email_settings").select("*").eq("workspace_id", workspace.id).maybeSingle<EmailSettings>(),
    supabase.from("pipeline_stages").select("*").eq("workspace_id", workspace.id).order("position").returns<PipelineStage[]>(),
  ]);
  const all = stages ?? [];
  return {
    supabase,
    workspace,
    settings: settings ?? null,
    stages: all,
    openStageIds: all.filter((s) => s.kind === "open").map((s) => s.id),
  };
}

function followUpCutoff(workspace: Workspace): string {
  return new Date(Date.now() - workspace.follow_up_after_days * 86_400_000).toISOString();
}

/** Perché i solleciti non possono partire, oppure null se possono. */
function followUpsBlockedReason(scope: Scope): string | null {
  const { settings, workspace } = scope;
  if (!settings) return "Configura l'invio email.";
  if (!canReadReplies(settings)) {
    return "I solleciti automatici richiedono una casella collegata via SMTP: con Resend o SendGrid non è possibile sapere chi ha risposto.";
  }
  const checked = workspace.replies_checked_at ? new Date(workspace.replies_checked_at).getTime() : 0;
  if (Date.now() - checked > REPLY_CHECK_MAX_AGE_MS) {
    return "La casella non è stata letta nelle ultime 24 ore: i solleciti restano fermi per non scrivere a chi ha già risposto.";
  }
  return null;
}

// Filtri comuni: contatto raggiungibile, in una fase aperta, mai fermato.
function eligible(scope: Scope) {
  return scope.supabase
    .from("contacts")
    .select("*", { count: "exact" })
    .eq("workspace_id", scope.workspace.id)
    .in("stage_id", scope.openStageIds)
    .not("email", "is", null)
    .eq("automation_paused", false)
    .is("replied_at", null);
}

async function sentToday(scope: Scope): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await scope.supabase
    .from("emails")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", scope.workspace.id)
    .eq("automated", true)
    .eq("status", "sent")
    .gte("sent_at", start.toISOString());
  return count ?? 0;
}

export async function automationOverview(supabase: SupabaseClient, workspace: Workspace): Promise<AutomationOverview> {
  const scope = await loadScope(supabase, workspace);
  const max = workspace.max_follow_ups;
  const cutoff = followUpCutoff(workspace);
  const head = () => eligible(scope).limit(1);

  const [first, due, waiting, exhausted, replied, today] = await Promise.all([
    head().eq("outbound_count", 0),
    head().gte("outbound_count", 1).lte("outbound_count", max).lte("last_contacted_at", cutoff),
    head().gte("outbound_count", 1).lte("outbound_count", max).gt("last_contacted_at", cutoff),
    head().gt("outbound_count", max),
    scope.supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .not("replied_at", "is", null),
    sentToday(scope),
  ]);

  return {
    awaitingFirst: first.count ?? 0,
    followUpsDue: due.count ?? 0,
    waiting: waiting.count ?? 0,
    exhausted: exhausted.count ?? 0,
    replied: replied.count ?? 0,
    sentToday: today,
    followUpsBlocked: followUpsBlockedReason(scope),
  };
}

/** Legge la casella e registra le risposte dei contatti. Restituisce un errore leggibile, o null. */
export async function syncReplies(supabase: SupabaseClient, workspace: Workspace, force = false): Promise<string | null> {
  const scope = await loadScope(supabase, workspace);
  if (!scope.settings || !canReadReplies(scope.settings)) return null;

  const last = workspace.replies_checked_at ? new Date(workspace.replies_checked_at).getTime() : 0;
  if (!force && Date.now() - last < REPLY_CHECK_INTERVAL_MS) return null;

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, email")
    .eq("workspace_id", workspace.id)
    .not("email", "is", null)
    .gt("outbound_count", 0)
    .limit(10_000);
  const byEmail = new Map((contacts ?? []).map((c) => [String(c.email).toLowerCase(), c.id as string]));

  try {
    if (byEmail.size > 0) {
      // Un giorno di margine: la ricerca IMAP ragiona per date, non per orari.
      const since = new Date(Math.max(last - 86_400_000, Date.now() - 30 * 86_400_000));
      const replies = await fetchReplies(scope.settings, new Set(byEmail.keys()), since);
      if (replies.length > 0) {
        const { error } = await supabase.from("emails").upsert(
          replies.map((r) => ({
            workspace_id: workspace.id,
            contact_id: byEmail.get(r.from)!,
            direction: "inbound",
            kind: "custom",
            status: "sent",
            subject: r.subject.slice(0, 300),
            body: r.text,
            to_email: scope.settings!.from_email,
            sent_at: r.date.toISOString(),
            provider_message_id: r.messageId,
          })),
          { onConflict: "workspace_id,direction,provider_message_id", ignoreDuplicates: true },
        );
        if (error) throw new Error(error.message);
      }
    }
    workspace.replies_checked_at = new Date().toISOString();
    workspace.automation_last_error = null;
    await supabase
      .from("workspaces")
      .update({ replies_checked_at: workspace.replies_checked_at, automation_last_error: null })
      .eq("id", workspace.id);
    return null;
  } catch (error) {
    const message = `Lettura della casella non riuscita: ${error instanceof Error ? error.message : "errore sconosciuto"}`.slice(0, 400);
    await supabase.from("workspaces").update({ automation_last_error: message }).eq("id", workspace.id);
    return message;
  }
}

function senderName(settings: EmailSettings): string {
  return settings.from_name.split(/\s+[·|/–—-]\s+|,/)[0]?.trim() || settings.from_name;
}

async function processContact(scope: Scope, contact: Contact): Promise<"sent" | "skipped"> {
  const { supabase, workspace, settings, stages } = scope;

  // Presa in carico atomica: se un'altra esecuzione è arrivata prima, l'update non trova righe.
  const stale = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  const { data: claimed } = await supabase
    .from("contacts")
    .update({ automation_claimed_at: new Date().toISOString() })
    .eq("id", contact.id)
    .eq("outbound_count", contact.outbound_count)
    .is("replied_at", null)
    .or(`automation_claimed_at.is.null,automation_claimed_at.lt."${stale}"`)
    .select("id");
  if (!claimed?.length) return "skipped";

  const [{ data: notes }, { data: emails }] = await Promise.all([
    supabase
      .from("contact_notes")
      .select("id, contact_id, body, created_at")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<ContactNote[]>(),
    supabase
      .from("emails")
      .select("*")
      .eq("contact_id", contact.id)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(10)
      .returns<Email[]>(),
  ]);

  const stage = stages.find((s) => s.id === contact.stage_id)!;
  const isFirst = contact.outbound_count === 0;
  const kind = isFirst ? "first_contact" : "soft_follow_up";
  const draft = await generateEmailDraft({
    workspace,
    senderName: senderName(settings!),
    contact,
    stage,
    notes: notes ?? [],
    emails: emails ?? [],
    kind,
    now: new Date(),
  });

  // Un lead nella prima fase avanza alla successiva con il primo contatto.
  const open = stages.filter((s) => s.kind === "open");
  const nextStageId = isFirst && open[0]?.id === contact.stage_id && open[1] ? open[1].id : null;

  const { data: email, error } = await supabase
    .from("emails")
    .insert({
      workspace_id: workspace.id,
      contact_id: contact.id,
      kind,
      status: "sending",
      subject: draft.subject,
      body: draft.body,
      to_email: contact.email,
      ai_generated: true,
      automated: true,
      next_stage_id: nextStageId,
    })
    .select("id, workspace_id, to_email, subject, body")
    .single<{ id: string; workspace_id: string; to_email: string; subject: string; body: string }>();
  if (error || !email) throw new Error("Registrazione dell'email non riuscita.");

  const result = await dispatchEmail(supabase, email);
  if (!result.ok) throw new Error(result.error);
  return "sent";
}

/**
 * Lavora un gruppo di contatti: prima chi non ha mai ricevuto nulla, poi i
 * solleciti maturi. Si ferma al primo errore, che quasi sempre riguarda la
 * configurazione (chiave AI, credenziali di posta) e si ripeterebbe uguale
 * per tutti gli altri.
 */
export async function runAutomationBatch(
  supabase: SupabaseClient,
  workspace: Workspace,
  /** Numero massimo di contatti in questo gruppo: 1 per l'invio di prova. */
  size: number = CONCURRENCY,
): Promise<BatchResult> {
  const fail = async (error: string): Promise<BatchResult> => {
    await supabase.from("workspaces").update({ automation_last_error: error.slice(0, 400) }).eq("id", workspace.id);
    return { sent: 0, remaining: 0, error };
  };

  if (!workspace.automation_enabled) return { sent: 0, remaining: 0, error: null };
  const scope = await loadScope(supabase, workspace);
  if (!scope.settings) return fail("Configura l'invio email prima di avviare l'automazione.");
  if (!aiConfigured()) return fail("Assistente AI non configurato.");

  const replyError = await syncReplies(supabase, workspace);
  const blocked = replyError ?? followUpsBlockedReason(scope);

  const budget = workspace.daily_send_limit - (await sentToday(scope));
  if (budget <= 0) return { sent: 0, remaining: 0, error: null };

  const stale = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  const now = new Date().toISOString();
  const free = `automation_claimed_at.is.null,automation_claimed_at.lt."${stale}"`;
  // Un promemoria futuro fissato a mano ha la precedenza sulla sequenza.
  const noManualHold = `next_action_at.is.null,next_action_at.lte."${now}"`;
  const take = Math.max(1, Math.min(size, CONCURRENCY, budget));

  const first = await eligible(scope).eq("outbound_count", 0).or(free).or(noManualHold).order("created_at").limit(take).returns<Contact[]>();
  let batch = first.data ?? [];
  let remaining = first.count ?? 0;

  if (!blocked) {
    const due = await eligible(scope)
      .gte("outbound_count", 1)
      .lte("outbound_count", workspace.max_follow_ups)
      .lte("last_contacted_at", followUpCutoff(workspace))
      .or(free)
      .or(noManualHold)
      .order("last_contacted_at")
      .limit(take)
      .returns<Contact[]>();
    remaining += due.count ?? 0;
    batch = [...batch, ...(due.data ?? [])].slice(0, take);
  }
  if (batch.length === 0) return { sent: 0, remaining: 0, error: null };

  const outcomes = await Promise.allSettled(batch.map((c) => processContact(scope, c)));
  const sent = outcomes.filter((o) => o.status === "fulfilled" && o.value === "sent").length;
  const failure = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");

  if (failure) {
    const reason = failure.reason;
    const message =
      reason instanceof AIGenerationError || reason instanceof Error ? reason.message : "Invio automatico non riuscito.";
    await supabase.from("workspaces").update({ automation_last_error: message.slice(0, 400) }).eq("id", workspace.id);
    return { sent, remaining: Math.max(remaining - sent, 0), error: message };
  }
  if (!replyError && workspace.automation_last_error) {
    await supabase.from("workspaces").update({ automation_last_error: null }).eq("id", workspace.id);
  }
  return { sent, remaining: Math.max(remaining - batch.length, 0), error: null };
}
