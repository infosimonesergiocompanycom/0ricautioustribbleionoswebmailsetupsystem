import type { EmailKind } from "@/lib/types";

export interface EmailKindSpec {
  label: string;
  hint: string;
  /** Obiettivo consegnato al modello: descrive l'intento, lo stile resta al brand. */
  brief: string;
}

export const EMAIL_KINDS: Record<Exclude<EmailKind, "custom">, EmailKindSpec> = {
  first_contact: {
    label: "Primo contatto",
    hint: "Informativo, costruito sull'interesse specifico",
    brief:
      "Primo contatto. Riprendi il motivo concreto per cui questa persona è entrata in relazione con noi (fonte del lead, interesse espresso, quanto emerge dalle note) e offri l'informazione che le serve davvero su quel punto. L'email si chiude con un passo successivo semplice e facile da accettare, senza pressione.",
  },
  soft_follow_up: {
    label: "Follow-up morbido",
    hint: "Per chi non ha risposto, senza insistere",
    brief:
      "Follow-up dopo un silenzio. Riallacciati con naturalezza all'ultimo scambio senza far pesare la mancata risposta e senza formule come \"le scrivo per sollecitare\". Aggiungi un elemento nuovo e utile (un chiarimento, una risposta a un dubbio emerso dalle note, una semplificazione della scelta) e lascia alla persona piena libertà di rispondere quando preferisce. Deve essere più breve dell'email precedente.",
  },
  case_study: {
    label: "Approfondimento / Case study",
    hint: "Un contenuto di valore legato al suo caso",
    brief:
      "Invio di un approfondimento. Collega il contenuto alla situazione specifica del contatto: spiega in due o tre frasi perché è pertinente per lui e che cosa ne può ricavare. Cita soltanto casi, risultati e materiali presenti nel contesto del brand o nelle note; se non c'è un materiale preciso da allegare, proponi di inviarlo e chiedi su quale aspetto preferisce concentrarsi.",
  },
  closing_call: {
    label: "Chiusura / Proposta call",
    hint: "Porta la trattativa a un appuntamento",
    brief:
      "Proposta di una call per arrivare a una decisione. Riassumi in una frase il punto a cui è arrivata la conversazione, affronta con franchezza l'eventuale dubbio ancora aperto (per esempio sul prezzo, se emerge dalle note) e proponi una chiamata breve indicando una durata e chiedendo la disponibilità. Tono sicuro e cordiale, nessuna urgenza artificiale.",
  },
};

export const EMAIL_KIND_ORDER = ["first_contact", "soft_follow_up", "case_study", "closing_call"] as const;

export function emailKindLabel(kind: EmailKind): string {
  return kind === "custom" ? "Email" : EMAIL_KINDS[kind].label;
}
