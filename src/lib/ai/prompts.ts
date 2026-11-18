import type { Contact, ContactNote, Email, EmailKind, PipelineStage, Workspace } from "@/lib/types";
import { fullName } from "@/lib/types";
import { EMAIL_KINDS } from "./email-kinds";

export interface EmailContext {
  workspace: Workspace;
  senderName: string | null;
  contact: Contact;
  stage: PipelineStage;
  notes: ContactNote[];
  emails: Email[];
  kind: Exclude<EmailKind, "custom">;
  now: Date;
}

const LANGUAGES: Record<string, string> = { it: "italiano", en: "inglese", fr: "francese" };

function block(tag: string, content: string | null | undefined): string {
  const text = content?.trim();
  return text ? `<${tag}>\n${text}\n</${tag}>` : "";
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "Europe/Rome" }).format(new Date(iso));
}

/**
 * Prompt di sistema: identità e contesto del brand. Dipende solo dal
 * workspace, quindi resta identico tra una generazione e l'altra e può
 * essere messo in cache.
 */
export function buildSystemPrompt(workspace: Workspace, senderName: string | null): string {
  const language = LANGUAGES[workspace.language] ?? workspace.language;

  return [
    `Sei il segretario personale di ${senderName ?? "chi ti scrive"}, che lavora per ${workspace.name}. Prepari le email che questa persona invierà a suo nome, in prima persona, a potenziali clienti con cui ha una relazione individuale. Chi riceve l'email deve avere l'impressione, corretta, che qualcuno si sia seduto a scriverla pensando proprio a lui.`,

    block(
      "brand",
      [
        `Nome: ${workspace.name}`,
        workspace.industry && `Settore: ${workspace.industry}`,
        workspace.website && `Sito: ${workspace.website}`,
        workspace.description && `Prodotti e servizi:\n${workspace.description}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),

    block("tono_di_voce", workspace.tone_of_voice) ||
      "Il brand non ha ancora definito un tono di voce: scrivi in modo cordiale, professionale e diretto.",

    workspace.email_examples?.trim()
      ? `${block("email_di_riferimento", workspace.email_examples)}\nLe email qui sopra sono state scritte dal brand. Assorbine ritmo, lessico, livello di formalità e modo di aprire e chiudere; non riprenderne frasi né contenuti.`
      : "",

    `Come scrivi:
- Scrivi in ${language}, salvo che lo storico mostri che il contatto usa un'altra lingua.
- L'email nasce dai fatti che hai: note, storico, fase della trattativa. Il dettaglio specifico (dove vi siete incontrati, quale prodotto interessa, quale dubbio è rimasto aperto) è ciò che la distingue da una comunicazione di massa, quindi usalo.
- Non inventare nulla: prezzi, sconti, scadenze, risultati, allegati, incontri o promesse compaiono solo se presenti nel contesto. Se un'informazione manca, costruisci l'email senza di essa.
- Lunghezza da email personale: di norma tra 60 e 140 parole. Un solo obiettivo e una sola richiesta per messaggio.
- Testo semplice, senza markdown, elenchi puntati, grassetti o emoji, a meno che le email di riferimento li usino.
- Niente formule da newsletter o da venditore ("Spero che questa email ti trovi bene", "Non perdere l'occasione", "Siamo leader nel settore"), niente segnaposto tra parentesi quadre: l'email deve poter partire così com'è.
- Scegli tra "tu" e "Lei" seguendo il tono di voce del brand e, se esiste, il registro già usato nello storico.
- Oggetto breve e concreto, come lo scriverebbe una persona a un'altra: niente maiuscole gridate né punti esclamativi.
- Chiudi con il saluto e il solo nome di chi firma${senderName ? ` (${senderName.split(" ")[0]})` : ""}. La firma completa con i recapiti viene aggiunta automaticamente dopo il testo: non scriverla.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Messaggio utente: tutto ciò che riguarda il singolo contatto e la richiesta. */
export function buildContextMessage(ctx: EmailContext): string {
  const { contact, stage, notes, emails, kind, now } = ctx;
  const spec = EMAIL_KINDS[kind];

  const profile = [
    `Nome: ${fullName(contact)}`,
    contact.company && `Azienda: ${contact.company}`,
    contact.job_title && `Ruolo: ${contact.job_title}`,
    contact.source && `Fonte del lead: ${contact.source}`,
    contact.tags.length > 0 && `Tag: ${contact.tags.join(", ")}`,
    `Fase nella pipeline: ${stage.name}`,
    contact.last_contacted_at
      ? `Ultimo contatto: ${formatDate(contact.last_contacted_at)}`
      : "Ultimo contatto: nessuno, non gli abbiamo ancora scritto",
    contact.next_action && `Prossima azione prevista: ${contact.next_action}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Ordine cronologico: il modello legge la relazione come si è svolta.
  const notesText = [...notes]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((n) => `[${formatDate(n.created_at)}] ${n.body}`)
    .join("\n\n");

  const history = emails
    .filter((e) => e.status === "sent")
    .sort((a, b) => (a.sent_at ?? a.created_at).localeCompare(b.sent_at ?? b.created_at))
    .map((e) => {
      const who = e.direction === "outbound" ? "Inviata da noi" : "Ricevuta dal contatto";
      return `--- ${who} il ${formatDate(e.sent_at ?? e.created_at)} ---\nOggetto: ${e.subject}\n\n${e.body}`;
    })
    .join("\n\n");

  return [
    `Oggi è ${formatDate(now.toISOString())}.`,
    block("contatto", profile),
    block("note", notesText) || "Non ci sono note su questo contatto.",
    block("storico_email", history) || "Non ci sono email precedenti con questo contatto.",
    block("richiesta", `${spec.label}. ${spec.brief}`),
    "Scrivi l'email: oggetto e corpo.",
  ].join("\n\n");
}

export function buildFeedbackMessage(feedback: string): string {
  return `Ho letto la bozza. Riscrivila tenendo conto di questa indicazione, e lascia invariato ciò che l'indicazione non tocca:\n\n${feedback.trim()}`;
}
