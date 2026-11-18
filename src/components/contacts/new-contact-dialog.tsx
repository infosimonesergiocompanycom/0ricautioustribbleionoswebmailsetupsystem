"use client";

import { useActionState, useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { createContact, type ContactFormState } from "@/actions/contacts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { PipelineStage } from "@/lib/types";

function TextField({ name, label, ...props }: { name: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`nc-${name}`}>{label}</Label>
      <Input id={`nc-${name}`} name={name} className="h-9" {...props} />
    </div>
  );
}

export function NewContactDialog({
  slug,
  stages,
  defaultOpen = false,
}: {
  slug: string;
  stages: PipelineStage[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, action, pending] = useActionState<ContactFormState, FormData>(async (prev, formData) => {
    const result = await createContact(prev, formData);
    if (result.createdId) {
      setOpen(false);
      toast.success("Contatto aggiunto");
    }
    return result;
  }, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="lg" />}>
        <PlusIcon />
        Nuovo contatto
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto p-6 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-normal">Nuovo contatto</DialogTitle>
          <DialogDescription>Basta il nome per cominciare: il resto si completa anche dopo.</DialogDescription>
        </DialogHeader>

        <form action={action} className="mt-2 space-y-4">
          <input type="hidden" name="slug" value={slug} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="first_name" label="Nome" required maxLength={80} autoFocus />
            <TextField name="last_name" label="Cognome" maxLength={80} />
            <TextField name="email" label="Email" type="email" />
            <TextField name="phone" label="Telefono" type="tel" maxLength={40} />
            <TextField name="company" label="Azienda" maxLength={120} />
            <TextField name="job_title" label="Ruolo" maxLength={120} />
            <TextField name="source" label="Fonte del lead" maxLength={120} placeholder="Es. fiera, sito, passaparola" />
            <div className="space-y-1.5">
              <Label htmlFor="nc-stage">Fase</Label>
              <NativeSelect id="nc-stage" name="stage_id" defaultValue={stages[0]?.id ?? ""}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <TextField name="tags" label="Tag" maxLength={400} placeholder="Separati da virgola" />
          <div className="space-y-1.5">
            <Label htmlFor="nc-note">Nota</Label>
            <Textarea
              id="nc-note"
              name="note"
              rows={3}
              maxLength={4000}
              placeholder="Dove vi siete conosciuti, che cosa gli interessa, quali dubbi ha espresso."
            />
          </div>

          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="lg" onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Salvataggio…" : "Salva contatto"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
