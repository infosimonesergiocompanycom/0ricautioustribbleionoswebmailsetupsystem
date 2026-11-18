"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateBrandProfile, type FormState } from "@/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Workspace } from "@/lib/types";

export function BrandForm({ workspace, canEdit }: { workspace: Workspace; canEdit: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateBrandProfile, {});

  useEffect(() => {
    if (state.saved) toast.success("Profilo aziendale salvato");
  }, [state]);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="slug" value={workspace.slug} />
      <fieldset disabled={!canEdit || pending} className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="b-name">Nome azienda</Label>
            <Input id="b-name" name="name" defaultValue={workspace.name} required maxLength={120} className="h-9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-industry">Settore</Label>
            <Input id="b-industry" name="industry" defaultValue={workspace.industry ?? ""} maxLength={120} className="h-9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-website">Sito web</Label>
            <Input id="b-website" name="website" defaultValue={workspace.website ?? ""} maxLength={200} className="h-9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-language">Lingua delle email</Label>
            <NativeSelect id="b-language" name="language" defaultValue={workspace.language}>
              <option value="it">Italiano</option>
              <option value="en">Inglese</option>
              <option value="fr">Francese</option>
            </NativeSelect>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="b-description">Prodotti e servizi</Label>
          <Textarea
            id="b-description"
            name="description"
            defaultValue={workspace.description ?? ""}
            rows={5}
            maxLength={4000}
            placeholder="Che cosa offre l'azienda, a chi si rivolge, prezzi indicativi, casi di successo che si possono citare."
          />
          <p className="text-xs text-muted-foreground">
            Il segretario cita soltanto ciò che trova qui e nelle note del contatto: più sei preciso, più le email lo saranno.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="b-tone">Tono di voce</Label>
          <Textarea
            id="b-tone"
            name="tone_of_voice"
            defaultValue={workspace.tone_of_voice ?? ""}
            rows={5}
            maxLength={4000}
            placeholder="Es. diamo del Lei, frasi brevi, tono consulenziale e pacato. Mai superlativi né urgenze. Chiudiamo con «Un caro saluto»."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="b-examples">Email già scritte</Label>
          <Textarea
            id="b-examples"
            name="email_examples"
            defaultValue={workspace.email_examples ?? ""}
            rows={8}
            maxLength={12000}
            placeholder="Incolla due o tre email che rappresentano bene il vostro stile, separate da una riga vuota."
          />
          <p className="text-xs text-muted-foreground">
            Servono da riferimento per ritmo e lessico: il contenuto non viene riutilizzato.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="b-signature">Firma</Label>
          <Textarea
            id="b-signature"
            name="signature"
            defaultValue={workspace.signature ?? ""}
            rows={4}
            maxLength={1000}
            placeholder={"Nome Cognome\nRuolo · Azienda\n+39 …"}
          />
        </div>
      </fieldset>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {canEdit && (
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva profilo"}
        </Button>
      )}
    </form>
  );
}
