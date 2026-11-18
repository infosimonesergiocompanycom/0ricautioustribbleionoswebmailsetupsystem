import type { Metadata } from "next";
import { NewContactDialog } from "@/components/contacts/new-contact-dialog";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import { ViewTabs } from "@/components/pipeline/view-tabs";
import { listStages, requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/lib/types";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({ params }: PageProps<"/w/[slug]/pipeline">) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const supabase = await createClient();
  const [stages, { data: contacts }] = await Promise.all([
    listStages(workspace.id),
    supabase
      .from("contacts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(1000)
      .returns<Contact[]>(),
  ]);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl">Pipeline</h1>
          <p className="mt-1.5 text-muted-foreground">Trascina un contatto per spostarlo di fase.</p>
        </div>
        <NewContactDialog slug={slug} stages={stages} />
      </header>
      <div className="mt-8 mb-6 flex justify-end">
        <ViewTabs slug={slug} active="kanban" />
      </div>
      <KanbanBoard slug={slug} stages={stages} contacts={contacts ?? []} />
    </div>
  );
}
