import type { Metadata } from "next";
import Link from "next/link";
import { CreateWorkspaceForm } from "@/components/workspace/create-workspace-form";
import { listWorkspaces, requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Nuova azienda" };

export default async function NewWorkspacePage() {
  await requireUser();
  const workspaces = await listWorkspaces();
  const first = workspaces.length === 0;

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-20">
      {!first && (
        <Link href={`/w/${workspaces[0].slug}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← Torna alle tue aziende
        </Link>
      )}
      <h1 className="mt-6 text-4xl">{first ? "Cominciamo dalla tua azienda" : "Nuova azienda"}</h1>
      <p className="mt-3 mb-12 text-muted-foreground">
        Ogni azienda ha contatti, pipeline, tono di voce e mittente email propri, del tutto separati dalle altre.
      </p>
      <CreateWorkspaceForm />
    </main>
  );
}
