import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { EMAIL_KINDS } from "@/lib/ai/email-kinds";
import type { TodoItem, TodoUrgency } from "@/lib/secretary/todo";
import { fullName } from "@/lib/types";

const SECTIONS: { urgency: TodoUrgency; title: string; note: string }[] = [
  { urgency: "overdue", title: "In ritardo", note: "Avevi previsto di farti sentire, o stanno ancora aspettando una prima risposta." },
  { urgency: "today", title: "Per oggi", note: "Azioni pianificate per la giornata e lead appena arrivati." },
  { urgency: "suggested", title: "Da non lasciar raffreddare", note: "Nessun promemoria fissato, ma il silenzio dura da troppo per la fase in cui si trovano." },
];

function TodoRow({ item, slug }: { item: TodoItem; slug: string }) {
  const { contact, stage, reason, suggestedKind } = item;
  const href = `/w/${slug}/contacts/${contact.id}`;

  return (
    <li className="group flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link href={href} className="font-medium underline-offset-4 hover:underline">
            {fullName(contact)}
          </Link>
          {contact.company && <span className="text-sm text-muted-foreground">{contact.company}</span>}
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{stage.name}</span>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{reason}</p>
      </div>
      <Link
        href={`${href}?compose=${suggestedKind}`}
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border px-3 py-1.5 text-sm transition-colors hover:border-foreground/30 hover:bg-muted sm:self-center"
      >
        Prepara: {EMAIL_KINDS[suggestedKind].label.toLowerCase()}
        <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

export function TodoList({ items, slug }: { items: TodoItem[]; slug: string }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-16 text-center">
        <p className="font-heading text-2xl">Nessuno da ricontattare oggi</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Tutte le trattative aperte hanno ricevuto attenzione di recente o hanno un promemoria fissato più avanti.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {SECTIONS.map(({ urgency, title, note }) => {
        const group = items.filter((i) => i.urgency === urgency);
        if (group.length === 0) return null;
        return (
          <section key={urgency} aria-labelledby={`todo-${urgency}`}>
            <div className="flex items-baseline justify-between gap-4 border-b pb-3">
              <h2 id={`todo-${urgency}`} className="text-xl">
                {title}
              </h2>
              <span className="text-sm tabular-nums text-muted-foreground">{group.length}</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{note}</p>
            <ul className="divide-y">
              {group.map((item) => (
                <TodoRow key={item.contact.id} item={item} slug={slug} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
