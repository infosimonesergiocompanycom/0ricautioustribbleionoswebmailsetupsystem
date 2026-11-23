"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateAutomationSettings, type AutomationFormState } from "@/actions/automation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EmailProvider, Workspace } from "@/lib/types";

export function AutomationForm({
  workspace,
  canEdit,
  emailProvider,
}: {
  workspace: Workspace;
  canEdit: boolean;
  emailProvider: EmailProvider | null;
}) {
  const [state, action, pending] = useActionState<AutomationFormState, FormData>(updateAutomationSettings, {});

  useEffect(() => {
    if (state.saved) toast.success("Automazione aggiornata");
  }, [state]);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="slug" value={workspace.slug} />
      <fieldset disabled={!canEdit || pending} className="space-y-6">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 has-checked:border-foreground/30 has-checked:bg-muted/50">
          <input
            type="checkbox"
            name="automation_enabled"
            defaultChecked={workspace.automation_enabled}
            className="mt-1 size-4 accent-primary"
          />
          <span>
            <span className="block font-medium">Invia le email in automatico</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Le email partono senza che tu le legga prima. Riguarda i contatti con un indirizzo email, in una fase
              aperta, che non hanno ancora risposto e che non hai escluso.
            </span>
          </span>
        </label>

        <div className="grid gap-6 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="a-days">Sollecita dopo (giorni)</Label>
            <Input
              id="a-days"
              name="follow_up_after_days"
              type="number"
              min={1}
              max={60}
              defaultValue={workspace.follow_up_after_days}
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-max">Numero di solleciti</Label>
            <Input
              id="a-max"
              name="max_follow_ups"
              type="number"
              min={0}
              max={5}
              defaultValue={workspace.max_follow_ups}
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-limit">Massimo di email al giorno</Label>
            <Input
              id="a-limit"
              name="daily_send_limit"
              type="number"
              min={1}
              max={1000}
              defaultValue={workspace.daily_send_limit}
              className="h-9"
            />
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {emailProvider === "smtp"
            ? "Per sapere chi ha risposto, il segretario legge la posta in arrivo della casella configurata sopra, senza modificarla. Se la lettura non riesce, i solleciti restano fermi."
            : "I solleciti richiedono una casella collegata via SMTP (per esempio Gmail): con Resend o SendGrid parte solo il primo contatto, perché non è possibile sapere chi ha risposto."}{" "}
          Il controllo automatico avviene una volta al giorno; dalla pagina «Oggi» puoi avviarlo quando vuoi.
        </p>
      </fieldset>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {canEdit && (
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva automazione"}
        </Button>
      )}
    </form>
  );
}
