import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PipelineStage, Workspace, WorkspaceRole, WorkspaceSummary } from "@/lib/types";

export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export const listWorkspaces = cache(async (): Promise<WorkspaceSummary[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, slug, name, industry")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
});

/**
 * Risolve il workspace dallo slug nell'URL. La RLS restituisce la riga solo
 * se l'utente ne è membro: uno slug altrui equivale a uno inesistente.
 */
export const requireWorkspace = cache(
  async (slug: string): Promise<{ workspace: Workspace; role: WorkspaceRole }> => {
    const user = await requireUser();
    const supabase = await createClient();
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("*")
      .eq("slug", slug)
      .maybeSingle<Workspace>();
    if (!workspace) notFound();

    const { data: member } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .maybeSingle<{ role: WorkspaceRole }>();
    if (!member) notFound();

    return { workspace, role: member.role };
  },
);

export const listStages = cache(async (workspaceId: string): Promise<PipelineStage[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("position");
  if (error) throw new Error(error.message);
  return data ?? [];
});
