import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getVercelOidcToken } from "@vercel/oidc";
import { z } from "zod";
import type { EmailDraft } from "@/lib/types";
import {
  buildContextMessage,
  buildFeedbackMessage,
  buildSystemPrompt,
  type EmailContext,
} from "./prompts";

const DraftSchema = z.object({
  subject: z.string().describe("Oggetto dell'email"),
  body: z.string().describe("Corpo dell'email in testo semplice, dal saluto iniziale al nome di chi firma"),
});

export interface Revision {
  /** Bozza corrente, comprese le eventuali modifiche manuali dell'utente. */
  draft: EmailDraft;
  feedback: string;
}

export class AIGenerationError extends Error {}

const MODEL = process.env.AI_MODEL ?? "claude-opus-5-5";

/**
 * Due strade verso lo stesso modello, sempre con l'SDK Anthropic:
 *  - ANTHROPIC_API_KEY: chiamata diretta all'API di Anthropic;
 *  - su Vercel, senza chiave: Vercel AI Gateway, che espone la stessa
 *    Messages API e autentica la funzione con il suo token OIDC. I consumi
 *    finiscono sul conto Vercel del progetto.
 */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL);
}

async function resolveClient(): Promise<{ client: Anthropic; model: string }> {
  if (process.env.ANTHROPIC_API_KEY) return { client: new Anthropic(), model: MODEL };

  let apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey && process.env.VERCEL) {
    try {
      apiKey = await getVercelOidcToken();
    } catch {
      throw new AIGenerationError("Assistente AI non raggiungibile: token Vercel non disponibile per questa funzione.");
    }
  }
  if (!apiKey) throw new AIGenerationError("Assistente AI non configurato: imposta ANTHROPIC_API_KEY.");

  return {
    // Il gateway si aspetta `Authorization: Bearer`: è ciò che invia `authToken`
    // (con `apiKey` l'SDK userebbe l'header x-api-key, che il token OIDC non supera).
    client: new Anthropic({ authToken: apiKey, apiKey: null, baseURL: "https://ai-gateway.vercel.sh" }),
    model: MODEL.includes("/") ? MODEL : `anthropic/${MODEL}`,
  };
}

function parseLooseJson(text: string): EmailDraft | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = DraftSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Genera la bozza di un'email. Con `revision` la richiesta diventa una
 * conversazione a più turni: contesto, bozza precedente, indicazione
 * dell'utente. Così il modello corregge la bozza invece di ripartire da zero.
 */
export async function generateEmailDraft(ctx: EmailContext, revision?: Revision): Promise<EmailDraft> {
  const { client, model } = await resolveClient();
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildSystemPrompt(ctx.workspace, ctx.senderName), cache_control: { type: "ephemeral" } },
  ];

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildContextMessage(ctx) }];
  if (revision) {
    messages.push(
      { role: "assistant", content: JSON.stringify(revision.draft) },
      { role: "user", content: buildFeedbackMessage(revision.feedback) },
    );
  }

  try {
    let response;
    try {
      response = await client.messages.parse({
        model,
        max_tokens: 16000,
        system,
        messages,
        output_config: { effort: "medium", format: zodOutputFormat(DraftSchema) },
      });
    } catch (error) {
      // Un intermediario che non inoltra l'output strutturato risponde 400:
      // si ripiega sul JSON richiesto a parole e letto dal testo.
      if (!(error instanceof Anthropic.BadRequestError)) throw error;
      console.warn("Output strutturato rifiutato, ripiego sul JSON nel testo:", error.message);
      const plain = await client.messages.create({
        model,
        max_tokens: 16000,
        system,
        messages: [
          ...messages,
          {
            role: "user",
            content: 'Rispondi soltanto con un oggetto JSON di questa forma, senza altro testo: {"subject": "...", "body": "..."}',
          },
        ],
      });
      const text = plain.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const draft = plain.stop_reason === "refusal" ? null : parseLooseJson(text);
      if (!draft) throw new AIGenerationError("La bozza è arrivata in un formato non leggibile. Riprova.");
      return { subject: draft.subject.trim(), body: draft.body.trim() };
    }

    if (response.stop_reason === "refusal") {
      throw new AIGenerationError("L'assistente non ha potuto elaborare questa richiesta.");
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new AIGenerationError("La bozza è arrivata incompleta. Riprova.");
    }

    const { subject, body } = response.parsed_output;
    return { subject: subject.trim(), body: body.trim() };
  } catch (error) {
    if (error instanceof AIGenerationError) throw error;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error("Accesso AI rifiutato", error.status, error.message);
      throw new AIGenerationError(
        `Accesso all'assistente AI rifiutato (${error.status}): ${error.message.slice(0, 200)}`,
      );
    }
    if (error instanceof Anthropic.APIError && error.status === 402) {
      throw new AIGenerationError("Credito AI esaurito sul conto Vercel: aggiungi credito in Vercel → AI Gateway.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AIGenerationError("Troppe richieste all'assistente in questo momento. Riprova tra poco.");
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new AIGenerationError("Assistente non raggiungibile. Controlla la connessione e riprova.");
    }
    if (error instanceof Anthropic.APIError) {
      console.error("Errore Anthropic API", error.status, error.message);
      throw new AIGenerationError("L'assistente ha restituito un errore. Riprova.");
    }
    throw error;
  }
}
