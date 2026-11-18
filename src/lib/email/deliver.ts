import "server-only";
import nodemailer from "nodemailer";
import { decryptSecret } from "@/lib/crypto";
import type { EmailSettings } from "@/lib/types";

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
  signature: string | null;
}

export class EmailDeliveryError extends Error {}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function composeText(body: string, signature: string | null): string {
  const sig = signature?.trim();
  return sig ? `${body.trim()}\n\n${sig}` : body.trim();
}

function toHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 1em">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a">${paragraphs}</div>`;
}

async function httpSend(url: string, apiKey: string, payload: unknown): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new EmailDeliveryError(`Il provider ha rifiutato l'invio (${res.status}): ${detail}`);
  }
  return res;
}

/**
 * Invia l'email con il provider configurato per il workspace e restituisce
 * l'identificativo del messaggio assegnato dal provider, quando disponibile.
 */
export async function deliverEmail(settings: EmailSettings, email: OutgoingEmail): Promise<string | null> {
  if (!settings.secret_ciphertext) {
    throw new EmailDeliveryError("Credenziali di invio mancanti: completa la configurazione email.");
  }
  const secret = decryptSecret(settings.secret_ciphertext);
  const text = composeText(email.body, email.signature);
  const html = toHtml(text);
  const from = `${settings.from_name} <${settings.from_email}>`;

  switch (settings.provider) {
    case "resend": {
      const res = await httpSend("https://api.resend.com/emails", secret, {
        from,
        to: [email.to],
        subject: email.subject,
        text,
        html,
        ...(settings.reply_to ? { reply_to: settings.reply_to } : {}),
      });
      const json = (await res.json().catch(() => null)) as { id?: string } | null;
      return json?.id ?? null;
    }
    case "sendgrid": {
      const res = await httpSend("https://api.sendgrid.com/v3/mail/send", secret, {
        personalizations: [{ to: [{ email: email.to }] }],
        from: { email: settings.from_email, name: settings.from_name },
        ...(settings.reply_to ? { reply_to: { email: settings.reply_to } } : {}),
        subject: email.subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      });
      return res.headers.get("x-message-id");
    }
    case "smtp": {
      // Copre anche Gmail / Google Workspace: smtp.gmail.com, porta 465, password per le app.
      const port = settings.smtp_port ?? 587;
      const transport = nodemailer.createTransport({
        host: settings.smtp_host ?? undefined,
        port,
        secure: port === 465,
        auth: { user: settings.smtp_user ?? settings.from_email, pass: secret },
        connectionTimeout: 15_000,
        socketTimeout: 20_000,
      });
      try {
        const info = await transport.sendMail({
          from,
          to: email.to,
          subject: email.subject,
          text,
          html,
          replyTo: settings.reply_to ?? undefined,
        });
        return info.messageId ?? null;
      } catch (error) {
        throw new EmailDeliveryError(
          `Invio SMTP non riuscito: ${error instanceof Error ? error.message : "errore sconosciuto"}`,
        );
      }
    }
  }
}
