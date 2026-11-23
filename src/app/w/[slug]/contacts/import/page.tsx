import type { Metadata } from "next";
import Link from "next/link";
import { ImportWizard } from "@/components/contacts/import-wizard";
import { listStages, requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Importa contatti" };

export default async function ImportPage({ params }: PageProps<"/w/[slug]/contacts/import">) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const stages = await listStages(workspace.id);

  return (
    <div>
      <Link href={`/w/${slug}/contacts`} className="text-sm text-muted-foreground hover:text-foreground">
        ← Contatti
      </Link>
      <h1 className="mt-5 text-4xl">Importa contatti</h1>
      <p className="mt-1.5 mb-10 max-w-xl text-muted-foreground">
        Carica un file e controlla la corrispondenza delle colonne prima di confermare. I contatti vengono aggiunti a{" "}
        {workspace.name}.
      </p>
      <ImportWizard slug={slug} firstStageName={stages[0]?.name ?? "Nuovo Lead"} />
    </div>
  );
}
