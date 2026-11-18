"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { updateEmailSettings, type FormState } from "@/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { EmailProvider, EmailSettings } from "@/lib/types";

export type EmailSettingsView = Omit<EmailSettings, "secret_ciphertext"> & { hasSecret: boolean };

const PROVIDER_HELP: Record<EmailProvider, string> = {
  resend: "Chiave API di Resend. Il dominio del mittente deve essere verificato nel tuo account Resend.",
  sendgrid: "Chiave API di SendGrid con permesso «Mail Send». Il mittente deve essere verificato.",
  smtp: "Per Gmail o Google Workspace: host smtp.gmail.com, porta 465, utente il tuo indirizzo e una «password per le app».",
};

export function EmailSettingsForm({
  slug,
  settings,
  canEdit,
}: {
  slug: string;
  settings: EmailSettingsView | null;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateEmailSettings, {});
  const [provider, setProvider] = useState<EmailProvider>(settings?.provider ?? "resend");
  const isSmtp = provider === "smtp";

  useEffect(() => {
    if (state.saved) toast.success("Configurazione email salvata");
  }, [state]);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="slug" value={slug} />
      <fieldset disabled={!canEdit || pending} className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="e-provider">Servizio di invio</Label>
            <NativeSelect
              id="e-provider"
              name="provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as EmailProvider)}
            >
              <option value="resend">Resend</option>
              <option value="sendgrid">SendGrid</option>
              <option value="smtp">SMTP (Gmail, Google Workspace, altri)</option>
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-secret">{isSmtp ? "Password SMTP" : "Chiave API"}</Label>
            <Input
              id="e-secret"
              name="secret"
              type="password"
              autoComplete="off"
              placeholder={settings?.hasSecret ? "Salvata. Compila solo per sostituirla" : ""}
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-from-name">Nome mittente</Label>
            <Input
              id="e-from-name"
              name="from_name"
              defaultValue={settings?.from_name ?? ""}
              required
              maxLength={120}
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-from-email">Indirizzo mittente</Label>
            <Input
              id="e-from-email"
              name="from_email"
              type="email"
              defaultValue={settings?.from_email ?? ""}
              required
              placeholder="nome@tuodominio.it"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-reply-to">Rispondi a (facoltativo)</Label>
            <Input id="e-reply-to" name="reply_to" type="email" defaultValue={settings?.reply_to ?? ""} className="h-9" />
          </div>
        </div>

        {/* I campi SMTP restano nel form anche quando nascosti: il server li ignora per gli altri provider. */}
        <div className={isSmtp ? "grid gap-6 sm:grid-cols-3" : "hidden"}>
          <div className="space-y-2">
            <Label htmlFor="e-host">Host</Label>
            <Input id="e-host" name="smtp_host" defaultValue={settings?.smtp_host ?? ""} placeholder="smtp.gmail.com" className="h-9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-port">Porta</Label>
            <Input id="e-port" name="smtp_port" inputMode="numeric" defaultValue={settings?.smtp_port ?? ""} placeholder="465" className="h-9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-user">Utente</Label>
            <Input id="e-user" name="smtp_user" defaultValue={settings?.smtp_user ?? ""} autoComplete="off" className="h-9" />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {PROVIDER_HELP[provider]} Il segreto viene cifrato prima del salvataggio e non è più visibile da questa pagina.
        </p>
      </fieldset>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {canEdit && (
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva configurazione"}
        </Button>
      )}
    </form>
  );
}
