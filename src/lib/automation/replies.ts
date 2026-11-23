import "server-only";
import { ImapFlow, type MessageStructureObject } from "imapflow";
import { decryptSecret } from "@/lib/crypto";
import type { EmailSettings } from "@/lib/types";

export interface InboundMessage {
  messageId: string;
  from: string;
  subject: string;
  date: Date;
  text: string;
}

/** La lettura delle risposte richiede una casella: è possibile solo con SMTP/IMAP. */
export function canReadReplies(settings: EmailSettings): boolean {
  return settings.provider === "smtp" && Boolean(settings.smtp_host) && Boolean(settings.secret_ciphertext);
}

function findTextPart(node: MessageStructureObject | undefined): string | null {
  if (!node) return null;
  if (node.type === "text/plain") return node.part ?? "1";
  for (const child of node.childNodes ?? []) {
    const found = findTextPart(child);
    if (found) return found;
  }
  return null;
}

async function streamToText(stream: NodeJS.ReadableStream, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    chunks.push(buf);
    size += buf.length;
    if (size >= limit) break;
  }
  return Buffer.concat(chunks).toString("utf8").slice(0, limit);
}

/**
 * Legge la posta in arrivo e restituisce i messaggi inviati dagli indirizzi
 * indicati. Sola lettura: non segna i messaggi come letti e non li sposta.
 */
export async function fetchReplies(
  settings: EmailSettings,
  senders: Set<string>,
  since: Date,
): Promise<InboundMessage[]> {
  const client = new ImapFlow({
    host: settings.smtp_host!.replace(/^smtp\./i, "imap."),
    port: 993,
    secure: true,
    auth: { user: settings.smtp_user ?? settings.from_email, pass: decryptSecret(settings.secret_ciphertext!) },
    logger: false,
    socketTimeout: 30_000,
  });

  const found: InboundMessage[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      if (uids.length === 0) return found;

      const matches: { uid: number; structure?: MessageStructureObject; message: Omit<InboundMessage, "text"> }[] = [];
      for await (const msg of client.fetch(uids, { envelope: true, bodyStructure: true }, { uid: true })) {
        const from = msg.envelope?.from?.[0]?.address?.toLowerCase();
        const messageId = msg.envelope?.messageId;
        if (!from || !messageId || !senders.has(from)) continue;
        matches.push({
          uid: msg.uid,
          structure: msg.bodyStructure,
          message: {
            messageId,
            from,
            subject: msg.envelope?.subject?.trim() || "(senza oggetto)",
            date: new Date(msg.envelope?.date ?? Date.now()),
          },
        });
      }

      for (const match of matches) {
        let text = "";
        const part = findTextPart(match.structure);
        if (part) {
          try {
            const { content } = await client.download(String(match.uid), part, { uid: true });
            if (content) text = (await streamToText(content, 8000)).trim();
          } catch {
            // Il testo è un di più: la risposta viene registrata comunque.
          }
        }
        found.push({ ...match.message, text: text || "(testo non disponibile: apri il messaggio nella casella di posta)" });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return found;
}
