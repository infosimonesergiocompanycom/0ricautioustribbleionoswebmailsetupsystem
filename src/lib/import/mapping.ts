import type { ParsedTable } from "./parse";

export type TargetField =
  | "full_name"
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "phone_alt"
  | "company"
  | "job_title"
  | "source"
  | "tags"
  | "created_at";

export const TARGET_FIELDS: { key: TargetField; label: string; hint?: string }[] = [
  { key: "full_name", label: "Nome completo", hint: "Viene diviso in nome e cognome" },
  { key: "first_name", label: "Nome" },
  { key: "last_name", label: "Cognome" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Telefono" },
  { key: "phone_alt", label: "Telefono (colonna alternativa)", hint: "Usata quando la prima è vuota" },
  { key: "company", label: "Azienda" },
  { key: "job_title", label: "Ruolo" },
  { key: "source", label: "Fonte del lead" },
  { key: "tags", label: "Tag" },
  { key: "created_at", label: "Data di arrivo del lead" },
];

/** Colonna di origine (indice) per ogni campo; assente se non mappato. */
export type Mapping = Partial<Record<TargetField, number>>;

export interface ImportRow {
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  source: string | null;
  tags: string[];
  created_at: string | null;
  note: string | null;
}

function normalize(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Sinonimi in italiano, inglese e francese, in ordine di preferenza.
const SYNONYMS: Record<TargetField, string[]> = {
  full_name: ["nom complet", "full name", "nome completo", "nome e cognome", "name", "nominativo", "contact name"],
  first_name: ["first name", "prenom", "nome", "given name"],
  last_name: ["last name", "cognome", "nom", "surname", "family name", "nom de famille"],
  email: ["e mail", "email", "mail", "courriel", "email address", "indirizzo email", "adresse e mail"],
  phone: ["phone number", "telefono", "phone", "telephone", "tel", "cellulare", "mobile", "numero di telefono"],
  phone_alt: ["numero de telephone", "telephone portable", "portable", "altro telefono"],
  company: ["company", "azienda", "societe", "entreprise", "company name", "organizzazione", "organization"],
  job_title: ["job title", "ruolo", "role", "fonction", "poste", "qualifica", "title"],
  source: ["source", "fonte", "lead source", "origine", "provenienza"],
  tags: ["tags", "tag", "etichette", "priority", "priorita", "labels"],
  created_at: ["created time", "created at", "data creazione", "date de creation", "data", "date", "created"],
};

// Colonne tecniche delle esportazioni pubblicitarie: non hanno valore in una nota.
const TECHNICAL = /(^id$| id$|^ad |^adset |^campaign |^form |is organic|^platform$|lead status|verified|^utm )/;

export function guessMapping(headers: string[]): Mapping {
  const normalized = headers.map(normalize);
  const mapping: Mapping = {};
  const used = new Set<number>();

  for (const field of Object.keys(SYNONYMS) as TargetField[]) {
    for (const synonym of SYNONYMS[field]) {
      const index = normalized.findIndex((h, i) => h === synonym && !used.has(i));
      if (index !== -1) {
        mapping[field] = index;
        used.add(index);
        break;
      }
    }
  }
  // Con il nome completo, "nom"/"nome" isolati sarebbero un doppione.
  if (mapping.full_name !== undefined && mapping.first_name === undefined) delete mapping.last_name;
  return mapping;
}

/** Colonne proposte per la nota: tutto ciò che non è mappato né tecnico. */
export function guessNoteColumns(headers: string[], mapping: Mapping): number[] {
  const mapped = new Set(Object.values(mapping));
  return headers
    .map((h, i) => ({ h: normalize(h), i }))
    .filter(({ h, i }) => h !== "" && !mapped.has(i) && !TECHNICAL.test(h))
    .map(({ i }) => i);
}

export function looksLikeMetaLeadAds(headers: string[]): boolean {
  const set = new Set(headers.map(normalize));
  return set.has("ad id") || set.has("campaign name") || set.has("form id");
}

/** "pour_quelle_occasion_?" → "Pour quelle occasion ?" */
export function humanize(text: string): string {
  const clean = text.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanPhone(value: string): string | null {
  const phone = value.replace(/^p:/i, "").trim();
  return phone || null;
}

function parseDate(value: string): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  // Una data futura o illeggibile falserebbe i giorni di attesa in dashboard.
  return Number.isNaN(time) || time > Date.now() ? null : new Date(time).toISOString();
}

export interface BuildOptions {
  mapping: Mapping;
  noteColumns: number[];
  /** Fonte applicata quando la colonna non è mappata o la cella è vuota. */
  defaultSource: string;
  /** Tag aggiunti a tutti i contatti importati. */
  extraTags: string[];
}

export interface BuildResult {
  rows: ImportRow[];
  skippedNoName: number;
  invalidEmails: number;
  mergedDuplicates: number;
}

/**
 * Trasforma la tabella in contatti. Le righe con la stessa email diventano un
 * solo contatto: tag e note si sommano, perché una persona che compila il
 * modulo due volte sta aggiungendo informazioni, non creando un secondo lead.
 */
export function buildRows(table: ParsedTable, options: BuildOptions): BuildResult {
  const { mapping, noteColumns, defaultSource, extraTags } = options;
  const cell = (row: string[], field: TargetField) => {
    const index = mapping[field];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  const byEmail = new Map<string, ImportRow>();
  const rows: ImportRow[] = [];
  let skippedNoName = 0;
  let invalidEmails = 0;
  let mergedDuplicates = 0;

  for (const row of table.rows) {
    let first = cell(row, "first_name");
    let last = cell(row, "last_name");
    if (!first) {
      const [head, ...rest] = cell(row, "full_name").split(/\s+/).filter(Boolean);
      first = head ?? "";
      if (!last) last = rest.join(" ");
    }
    if (!first) {
      skippedNoName += 1;
      continue;
    }

    const rawEmail = cell(row, "email").toLowerCase();
    const email = EMAIL.test(rawEmail) ? rawEmail : null;
    if (rawEmail && !email) invalidEmails += 1;

    const noteLines = noteColumns
      .map((i) => ({ label: humanize(table.headers[i] ?? ""), value: humanize(row[i] ?? "") }))
      .filter(({ value }) => value.replace(/[^\p{L}\p{N}]/gu, "") !== "")
      .map(({ label, value }) => {
        const question = label.replace(/\s*:$/, "");
        return /[?!]$/.test(question) ? `${question} ${value}` : `${question}: ${value}`;
      });
    if (rawEmail && !email) noteLines.push(`Email indicata (non valida): ${rawEmail}`);

    const tags = [
      ...cell(row, "tags").split(/[,;|]/),
      ...extraTags,
    ]
      .map((t) => t.trim())
      .filter(Boolean);

    const contact: ImportRow = {
      first_name: first.slice(0, 80),
      last_name: last ? last.slice(0, 80) : null,
      email,
      phone: cleanPhone(cell(row, "phone")) ?? cleanPhone(cell(row, "phone_alt")),
      company: cell(row, "company") || null,
      job_title: cell(row, "job_title") || null,
      source: cell(row, "source") || defaultSource.trim() || null,
      tags: [...new Set(tags)],
      created_at: parseDate(cell(row, "created_at")),
      note: noteLines.length > 0 ? noteLines.join("\n") : null,
    };

    const existing = email ? byEmail.get(email) : undefined;
    if (existing) {
      mergedDuplicates += 1;
      existing.tags = [...new Set([...existing.tags, ...contact.tags])];
      existing.phone ??= contact.phone;
      if (contact.note && contact.note !== existing.note) {
        existing.note = [existing.note, contact.note].filter(Boolean).join("\n\n— Altra richiesta —\n");
      }
      // Vale la richiesta più vecchia: è da allora che la persona aspetta.
      if (contact.created_at && (!existing.created_at || contact.created_at < existing.created_at)) {
        existing.created_at = contact.created_at;
      }
      continue;
    }
    if (email) byEmail.set(email, contact);
    rows.push(contact);
  }

  return { rows, skippedNoName, invalidEmails, mergedDuplicates };
}
