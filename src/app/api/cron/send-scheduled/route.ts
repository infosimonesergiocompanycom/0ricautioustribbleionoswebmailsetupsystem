import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchEmail } from "@/lib/email/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Spedisce le email programmate giunte a scadenza. Va richiamato a intervalli
 * regolari (per esempio ogni 5 minuti) con l'header
 * `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const supabase = createAdminClient();
  const { data: due, error } = await supabase
    .from("emails")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at")
    .limit(25);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const { id } of due ?? []) {
    // Presa in carico atomica: se un'altra esecuzione ha già cambiato lo
    // stato, l'update non restituisce righe e l'email viene saltata.
    const { data: claimed } = await supabase
      .from("emails")
      .update({ status: "sending" })
      .eq("id", id)
      .eq("status", "scheduled")
      .select("id, workspace_id, to_email, subject, body")
      .maybeSingle<{ id: string; workspace_id: string; to_email: string; subject: string; body: string }>();
    if (!claimed) continue;

    const result = await dispatchEmail(supabase, claimed);
    if (result.ok) sent += 1;
    else failed += 1;
  }

  return NextResponse.json({ due: due?.length ?? 0, sent, failed });
}
