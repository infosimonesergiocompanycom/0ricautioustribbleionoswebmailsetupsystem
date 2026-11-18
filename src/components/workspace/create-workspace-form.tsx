"use client";

import { useActionState } from "react";
import { createWorkspace, type FormState } from "@/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createWorkspace, {});

  return (
    <form action={action} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Nome dell&apos;azienda o del brand</Label>
        <Input id="name" name="name" required maxLength={120} autoFocus className="h-10" />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="industry">Settore</Label>
          <Input id="industry" name="industry" maxLength={120} placeholder="Es. arredamento su misura" className="h-10" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="website">Sito web</Label>
          <Input id="website" name="website" maxLength={200} placeholder="https://" className="h-10" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Prodotti e servizi</Label>
        <Textarea
          id="description"
          name="description"
          rows={4}
          maxLength={4000}
          placeholder="Che cosa offre l'azienda, a chi si rivolge, che cosa la distingue."
        />
        <p className="text-xs text-muted-foreground">
          Il segretario parte da qui per scrivere. Tono di voce, firma e invio email si completano subito dopo.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="h-10 px-5" disabled={pending}>
        {pending ? "Creazione…" : "Crea azienda"}
      </Button>
    </form>
  );
}
