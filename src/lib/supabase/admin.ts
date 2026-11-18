import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Client con service role: scavalca la RLS. Riservato al job degli invii
 * programmati, che gira senza utente collegato. Mai importarlo da codice
 * raggiungibile da una richiesta utente.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY non configurata.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
