import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runAutomationBatch } from "@/lib/automation/engine";
import { dispatchEmail } from "@/lib/email/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Workspace } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Margine per chiudere con ordine prima del limite della funzione.
const BUDGET_MS = 240_000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Job giornaliero (vedi vercel.json): spedisce le email programmate giunte a
 * scadenza, poi fa avanzare le sequenze automatiche di ogni azienda che le ha
 * attivate. Vercel lo richiama con `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const started = Date.now();
  const supabase = createAdminClient();
  const report = { scheduledSent: 0, scheduledFailed: 0, automated: 0, errors: [] as string[] };

  const { data: due } = await supabase
    .from("emails")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at")
    .limit(50);
  for (const { id } of due ?? []) {
    // Presa in carico atomica: se lo stato è già cambiato, l'update non trova righe.
    const { data: claimed } = await supabase
      .from("emails")
      .update({ status: "sending" })
      .eq("id", id)
      .eq("status", "scheduled")
      .select("id, workspace_id, to_email, subject, body")
      .maybeSingle<{ id: string; workspace_id: string; to_email: string; subject: string; body: string }>();
    if (!claimed) continue;
    const result = await dispatchEmail(supabase, claimed);
    if (result.ok) report.scheduledSent += 1;
    else report.scheduledFailed += 1;
  }

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("*")
    .eq("automation_enabled", true)
    .returns<Workspace[]>();
  for (const workspace of workspaces ?? []) {
    while (Date.now() - started < BUDGET_MS) {
      const batch = await runAutomationBatch(supabase, workspace);
      report.automated += batch.sent;
      if (batch.error) report.errors.push(`${workspace.slug}: ${batch.error}`);
      if (batch.error || batch.remaining === 0 || batch.sent === 0) break;
    }
  }

  return NextResponse.json(report);
}
