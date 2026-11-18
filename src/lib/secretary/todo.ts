import type { Contact, EmailKind, PipelineStage } from "@/lib/types";

export type TodoUrgency = "overdue" | "today" | "suggested";

export interface TodoItem {
  contact: Contact;
  stage: PipelineStage;
  urgency: TodoUrgency;
  /** Il "perché" mostrato all'utente. */
  reason: string;
  suggestedKind: Exclude<EmailKind, "custom">;
  /** Giorni di ritardo o di silenzio: ordina gli elementi a parità di urgenza. */
  weight: number;
}

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function kindFor(contact: Contact, stage: PipelineStage): Exclude<EmailKind, "custom"> {
  if (!contact.last_contacted_at) return "first_contact";
  return stage.suggested_kind === "custom" ? "soft_follow_up" : stage.suggested_kind;
}

/**
 * Costruisce l'agenda del giorno: chi ricontattare e perché.
 *
 * Regole, in ordine di precedenza per ogni contatto in una fase aperta:
 *  1. ha un'azione pianificata scaduta o in scadenza oggi;
 *  2. ha un'azione pianificata in futuro: non compare, la decisione è già presa;
 *  3. non è mai stato contattato;
 *  4. è in silenzio da più giorni di quanti ne ammette la sua fase.
 */
export function buildTodoList(contacts: Contact[], stages: PipelineStage[], now: Date = new Date()): TodoItem[] {
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const items: TodoItem[] = [];

  for (const contact of contacts) {
    const stage = stageById.get(contact.stage_id);
    if (!stage || stage.kind !== "open") continue;

    const suggestedKind = kindFor(contact, stage);
    const base = { contact, stage, suggestedKind };

    if (contact.next_action_at) {
      const late = daysBetween(new Date(contact.next_action_at), now);
      if (late < 0) continue;
      const action = contact.next_action?.trim() || "Ricontattare";
      items.push({
        ...base,
        urgency: late > 0 ? "overdue" : "today",
        reason:
          late > 0
            ? `${action}: era previsto ${plural(late, "giorno", "giorni")} fa.`
            : `${action}: previsto per oggi.`,
        weight: late,
      });
      continue;
    }

    if (!contact.last_contacted_at) {
      const age = daysBetween(new Date(contact.created_at), now);
      items.push({
        ...base,
        urgency: age >= (stage.follow_up_days ?? 1) ? "overdue" : "today",
        reason:
          age === 0
            ? "Lead arrivato oggi, non ha ancora ricevuto un primo contatto."
            : `Lead in attesa da ${plural(age, "giorno", "giorni")}, non ha ancora ricevuto un primo contatto.`,
        weight: age,
      });
      continue;
    }

    if (stage.follow_up_days) {
      const silence = daysBetween(new Date(contact.last_contacted_at), now);
      if (silence >= stage.follow_up_days) {
        items.push({
          ...base,
          urgency: "suggested",
          reason: `Nessun contatto da ${plural(silence, "giorno", "giorni")} nella fase «${stage.name}» (soglia: ${stage.follow_up_days}).`,
          weight: silence - stage.follow_up_days,
        });
      }
    }
  }

  const rank: Record<TodoUrgency, number> = { overdue: 0, today: 1, suggested: 2 };
  return items.sort((a, b) => rank[a.urgency] - rank[b.urgency] || b.weight - a.weight);
}
