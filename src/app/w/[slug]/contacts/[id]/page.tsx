import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NoteForm } from "@/components/contacts/note-form";
import { Timeline } from "@/components/contacts/timeline";
import { EmailComposer } from "@/components/email/email-composer";
import { EMAIL_KIND_ORDER } from "@/lib/ai/email-kinds";
import { formatDate, relativeDay } from "@/lib/format";
import { listStages, requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Activity, Contact, Email } from "@/lib/types";
import { fullName } from "@/lib/types";

export const metadata: Metadata = { title: "Contatto" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function ContactPage({ params, searchParams }: PageProps<"/w/[slug]/contacts/[id]">) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const { workspace } = await requireWorkspace(slug);
  const supabase = await createClient();

  // Ogni query filtra anche per workspace: un id valido di un'altra azienda
  // dello stesso utente non deve aprirsi sotto questo indirizzo.
  const [{ data: contact }, { data: activities }, { data: emails }, { count: emailConfigured }, stages] =
    await Promise.all([
      supabase.from("contacts").select("*").eq("workspace_id", workspace.id).eq("id", id).maybeSingle<Contact>(),
      supabase
        .from("activities")
        .select("id, contact_id, type, payload, created_at")
        .eq("workspace_id", workspace.id)
        .eq("contact_id", id)
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<Activity[]>(),
      supabase
        .from("emails")
        .select("*")
        .eq("workspace_id", workspace.id)
        .eq("contact_id", id)
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<Email[]>(),
      supabase
        .from("workspace_email_settings")
        .select("workspace_id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id),
      listStages(workspace.id),
    ]);
  if (!contact) notFound();

  const stage = stages.find((s) => s.id === contact.stage_id);
  const compose = typeof query.compose === "string" ? query.compose : undefined;
  const autoStart = EMAIL_KIND_ORDER.find((k) => k === compose);

  return (
    <div>
      <Link href={`/w/${slug}/contacts`} className="text-sm text-muted-foreground hover:text-foreground">
        ← Contatti
      </Link>

      <header className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl">{fullName(contact)}</h1>
          <p className="mt-1.5 text-muted-foreground">
            {[contact.job_title, contact.company].filter(Boolean).join(" · ") || "Nessuna azienda indicata"}
          </p>
        </div>
        {stage && <span className="rounded-full border px-3 py-1 text-sm">{stage.name}</span>}
      </header>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-14">
          <EmailComposer
            key={contact.id}
            slug={slug}
            contactId={contact.id}
            contactFirstName={contact.first_name}
            contactEmail={contact.email}
            currentStageId={contact.stage_id}
            stages={stages}
            emailConfigured={Boolean(emailConfigured)}
            signature={workspace.signature}
            autoStart={autoStart}
          />

          <section aria-labelledby="notes-title">
            <h2 id="notes-title" className="mb-4 text-xl">
              Note
            </h2>
            <NoteForm slug={slug} contactId={contact.id} />
          </section>

          <section aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="mb-6 text-xl">
              Storico
            </h2>
            <Timeline activities={activities ?? []} emails={emails ?? []} />
          </section>
        </div>

        <aside className="lg:border-l lg:pl-8">
          <dl className="grid grid-cols-2 gap-5 lg:grid-cols-1">
            <Field label="Email">
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="underline-offset-4 hover:underline">
                  {contact.email}
                </a>
              )}
            </Field>
            <Field label="Telefono">{contact.phone}</Field>
            <Field label="Fonte del lead">{contact.source}</Field>
            <Field label="Tag">
              {contact.tags.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {contact.tags.map((t) => (
                    <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {t}
                    </span>
                  ))}
                </span>
              )}
            </Field>
            <Field label="Ultimo contatto">
              {contact.last_contacted_at &&
                `${formatDate(contact.last_contacted_at)} (${relativeDay(contact.last_contacted_at)})`}
            </Field>
            <Field label="Prossima azione">
              {contact.next_action_at &&
                `${contact.next_action ?? "Ricontattare"}, ${relativeDay(contact.next_action_at)}`}
            </Field>
            <Field label="Creato il">{formatDate(contact.created_at)}</Field>
          </dl>
        </aside>
      </div>
    </div>
  );
}
