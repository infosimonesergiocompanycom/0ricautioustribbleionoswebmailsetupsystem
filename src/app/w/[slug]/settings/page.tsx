import type { Metadata } from "next";
import { BrandForm } from "@/components/settings/brand-form";
import { EmailSettingsForm, type EmailSettingsView } from "@/components/settings/email-settings-form";
import { listStages, requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { EmailSettings } from "@/lib/types";

export const metadata: Metadata = { title: "Impostazioni" };

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t py-12">
      <h2 id={`${id}-title`} className="text-2xl">
        {title}
      </h2>
      <p className="mt-1.5 mb-8 max-w-xl text-sm text-muted-foreground">{intro}</p>
      {children}
    </section>
  );
}

export default async function SettingsPage({ params, searchParams }: PageProps<"/w/[slug]/settings">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const { workspace, role } = await requireWorkspace(slug);
  const canEdit = role !== "member";

  const supabase = await createClient();
  const [{ data: settings }, stages] = await Promise.all([
    supabase.from("workspace_email_settings").select("*").eq("workspace_id", workspace.id).maybeSingle<EmailSettings>(),
    listStages(workspace.id),
  ]);

  // Il ciphertext resta sul server: al client arriva solo l'informazione che un segreto esiste.
  let view: EmailSettingsView | null = null;
  if (settings) {
    const { secret_ciphertext, ...rest } = settings;
    view = { ...rest, hasSecret: Boolean(secret_ciphertext) };
  }

  return (
    <div>
      <h1 className="text-4xl">Impostazioni</h1>
      <p className="mt-1.5 mb-10 text-muted-foreground">
        {query.welcome === "1"
          ? `${workspace.name} è pronta. Completa tono di voce e invio email: sono ciò che rende le bozze davvero tue.`
          : `Valgono soltanto per ${workspace.name}.`}
      </p>

      <Section
        id="brand"
        title="Profilo aziendale"
        intro="È il contesto che il segretario legge prima di scrivere ogni email per questa azienda."
      >
        <BrandForm workspace={workspace} canEdit={canEdit} />
      </Section>

      <Section
        id="email"
        title="Invio email"
        intro="Le email partono dal dominio dell'azienda, con il mittente e la firma indicati qui."
      >
        <EmailSettingsForm slug={slug} settings={view} canEdit={canEdit} />
      </Section>

      <Section
        id="pipeline"
        title="Fasi della pipeline"
        intro="Per ogni fase aperta, la soglia indica dopo quanti giorni di silenzio il segretario propone di ricontattare."
      >
        <ol className="divide-y text-sm">
          {stages.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-4 py-3">
              <span>{s.name}</span>
              <span className="text-muted-foreground">
                {s.kind === "open"
                  ? s.follow_up_days
                    ? `promemoria dopo ${s.follow_up_days} ${s.follow_up_days === 1 ? "giorno" : "giorni"}`
                    : "nessun promemoria"
                  : s.kind === "won"
                    ? "chiusura positiva"
                    : "chiusura negativa"}
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
