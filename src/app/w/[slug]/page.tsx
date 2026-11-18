import type { Metadata } from "next";
import Link from "next/link";
import { TodoList } from "@/components/dashboard/todo-list";
import { formatDateTime, formatLongDate, greeting } from "@/lib/format";
import { buildTodoList } from "@/lib/secretary/todo";
import { listStages, requireUser, requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/lib/types";
import { fullName } from "@/lib/types";

export const metadata: Metadata = { title: "Oggi" };

interface ScheduledEmail {
  id: string;
  subject: string;
  scheduled_at: string;
  contact: Pick<Contact, "id" | "first_name" | "last_name"> | null;
}

function summary(count: number): string {
  if (count === 0) return "Oggi non c'è nessuno in attesa di una tua parola.";
  if (count === 1) return "Oggi c'è una persona che conviene ricontattare. Ecco chi è, e perché.";
  return `Oggi ci sono ${count} persone che conviene ricontattare. Ecco chi sono, e perché.`;
}

export default async function DashboardPage({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const user = await requireUser();
  const { workspace } = await requireWorkspace(slug);
  const supabase = await createClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const stages = await listStages(workspace.id);
  const openStageIds = stages.filter((s) => s.kind === "open").map((s) => s.id);

  const [{ data: contacts }, { data: profile }, { count: sentThisWeek }, { data: scheduled }] = await Promise.all([
    supabase
      .from("contacts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .in("stage_id", openStageIds)
      .returns<Contact[]>(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle<{ full_name: string | null }>(),
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("status", "sent")
      .gte("sent_at", weekAgo),
    supabase
      .from("emails")
      .select("id, subject, scheduled_at, contact:contacts(id, first_name, last_name)")
      .eq("workspace_id", workspace.id)
      .eq("status", "scheduled")
      .order("scheduled_at")
      .limit(5)
      .returns<ScheduledEmail[]>(),
  ]);

  const todo = buildTodoList(contacts ?? [], stages, now);
  const firstName = profile?.full_name?.split(" ")[0];

  const stats = [
    { label: "Trattative aperte", value: contacts?.length ?? 0 },
    { label: "Da ricontattare", value: todo.length },
    { label: "Email inviate in 7 giorni", value: sentThisWeek ?? 0 },
  ];

  return (
    <div>
      <p className="text-sm text-muted-foreground first-letter:uppercase">{formatLongDate(now)}</p>
      <h1 className="mt-2 text-4xl md:text-5xl">
        {greeting(now)}
        {firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">{summary(todo.length)}</p>

      <dl className="mt-10 grid grid-cols-3 gap-6 border-y py-6">
        {stats.map((s) => (
          <div key={s.label}>
            <dd className="font-heading text-3xl tabular-nums">{s.value}</dd>
            <dt className="mt-1 text-xs text-muted-foreground sm:text-sm">{s.label}</dt>
          </div>
        ))}
      </dl>

      <div className="mt-14">
        {(contacts?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-16 text-center">
            <p className="font-heading text-2xl">Qui comparirà la tua agenda</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Aggiungi i primi contatti di {workspace.name}: da domani il segretario ti dirà ogni mattina a chi scrivere.
            </p>
            <Link
              href={`/w/${slug}/contacts?new=1`}
              className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/85"
            >
              Aggiungi un contatto
            </Link>
          </div>
        ) : (
          <TodoList items={todo} slug={slug} />
        )}
      </div>

      {scheduled && scheduled.length > 0 && (
        <section className="mt-16" aria-labelledby="scheduled">
          <h2 id="scheduled" className="border-b pb-3 text-xl">
            Invii programmati
          </h2>
          <ul className="divide-y">
            {scheduled.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 text-sm">
                <span className="min-w-0">
                  {e.contact && (
                    <Link
                      href={`/w/${slug}/contacts/${e.contact.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {fullName(e.contact)}
                    </Link>
                  )}
                  <span className="text-muted-foreground"> · {e.subject}</span>
                </span>
                <time className="shrink-0 text-muted-foreground tabular-nums">{formatDateTime(e.scheduled_at)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
