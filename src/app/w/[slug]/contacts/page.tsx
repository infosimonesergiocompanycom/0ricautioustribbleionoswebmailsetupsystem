import type { Metadata } from "next";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { NewContactDialog } from "@/components/contacts/new-contact-dialog";
import { ViewTabs } from "@/components/pipeline/view-tabs";
import { Input } from "@/components/ui/input";
import { relativeDay } from "@/lib/format";
import { listStages, requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/lib/types";
import { fullName } from "@/lib/types";

export const metadata: Metadata = { title: "Contatti" };

export default async function ContactsPage({ params, searchParams }: PageProps<"/w/[slug]/contacts">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const { workspace } = await requireWorkspace(slug);
  const stages = await listStages(workspace.id);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  // I caratteri con un significato nella sintassi dei filtri PostgREST vengono rimossi.
  const q = (typeof query.q === "string" ? query.q : "").replace(/[,()%*\\"]/g, " ").trim().slice(0, 80);

  const supabase = await createClient();
  let request = supabase
    .from("contacts")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (q) {
    const like = `%${q}%`;
    request = request.or(
      `first_name.ilike.${like},last_name.ilike.${like},company.ilike.${like},email.ilike.${like}`,
    );
  }
  const { data: contacts } = await request.returns<Contact[]>();

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl">Contatti</h1>
          <p className="mt-1.5 text-muted-foreground">
            {contacts?.length ?? 0} {q ? "risultati" : `in ${workspace.name}`}
          </p>
        </div>
        <NewContactDialog slug={slug} stages={stages} defaultOpen={query.new === "1"} />
      </header>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <form className="relative w-full max-w-xs" role="search">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Cerca per nome, azienda, email"
            aria-label="Cerca contatti"
            className="h-9 pl-8"
          />
        </form>
        <ViewTabs slug={slug} active="table" />
      </div>

      {contacts && contacts.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="py-3 pr-4 font-normal">Nome</th>
                <th className="px-4 py-3 font-normal">Azienda</th>
                <th className="px-4 py-3 font-normal">Fase</th>
                <th className="px-4 py-3 font-normal">Ultimo contatto</th>
                <th className="py-3 pl-4 font-normal">Prossima azione</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {contacts.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-muted/50">
                  <td className="py-3.5 pr-4">
                    <Link href={`/w/${slug}/contacts/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                      {fullName(c)}
                    </Link>
                    {c.email && <span className="block text-xs text-muted-foreground">{c.email}</span>}
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">{c.company ?? "—"}</td>
                  <td className="px-4 py-3.5">
                    <span className="rounded-full border px-2 py-0.5 text-xs whitespace-nowrap">
                      {stageName.get(c.stage_id)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">
                    {c.last_contacted_at ? relativeDay(c.last_contacted_at) : "mai"}
                  </td>
                  <td className="py-3.5 pl-4 text-muted-foreground">
                    {c.next_action_at ? `${c.next_action ?? "Ricontattare"}, ${relativeDay(c.next_action_at)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 rounded-xl border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
          {q ? `Nessun contatto corrisponde a «${q}».` : "Ancora nessun contatto: aggiungi il primo."}
        </p>
      )}
    </div>
  );
}
