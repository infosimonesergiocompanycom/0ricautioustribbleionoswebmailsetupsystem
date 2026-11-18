import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSettings } from "@/lib/types";
import { deliverEmail } from "./deliver";

interface DispatchRow {
  id: string;
  workspace_id: string;
  to_email: string;
  subject: string;
  body: string;
}

/**
 * Consegna un'email già registrata con stato "sending" e ne aggiorna l'esito.
 * Al passaggio a "sent" il trigger handle_email_status aggiorna il contatto
 * (ultimo contatto, fase, promemoria) e scrive lo storico.
 */
export async function dispatchEmail(
  supabase: SupabaseClient,
  email: DispatchRow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fail = async (message: string) => {
    await supabase.from("emails").update({ status: "failed", error: message }).eq("id", email.id);
    return { ok: false as const, error: message };
  };

  const [{ data: settings }, { data: workspace }] = await Promise.all([
    supabase
      .from("workspace_email_settings")
      .select("*")
      .eq("workspace_id", email.workspace_id)
      .maybeSingle<EmailSettings>(),
    supabase.from("workspaces").select("signature").eq("id", email.workspace_id).single<{ signature: string | null }>(),
  ]);
  if (!settings) return fail("Configurazione email assente per questa azienda.");

  try {
    const messageId = await deliverEmail(settings, {
      to: email.to_email,
      subject: email.subject,
      body: email.body,
      signature: workspace?.signature ?? null,
    });
    const { error } = await supabase
      .from("emails")
      .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: messageId, error: null })
      .eq("id", email.id);
    if (error) {
      console.error("Email consegnata ma stato non aggiornato", email.id, error.message);
      return { ok: false, error: "Email consegnata, ma l'aggiornamento dello storico non è riuscito." };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invio non riuscito.";
    return fail(message.slice(0, 500));
  }
}
