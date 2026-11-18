import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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

let client: Anthropic | undefined;

/**
 * Genera la bozza di un'email. Con `revision` la richiesta diventa una
 * conversazione a più turni: contesto, bozza precedente, indicazione
 * dell'utente. Così il modello corregge la bozza invece di ripartire da zero.
 */
export async function generateEmailDraft(ctx: EmailContext, revision?: Revision): Promise<EmailDraft> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AIGenerationError("Assistente AI non configurato: imposta ANTHROPIC_API_KEY.");
  }
  client ??= new Anthropic();

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildContextMessage(ctx) }];
  if (revision) {
    messages.push(
      { role: "assistant", content: JSON.stringify(revision.draft) },
      { role: "user", content: buildFeedbackMessage(revision.feedback) },
    );
  }

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: buildSystemPrompt(ctx.workspace, ctx.senderName),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
      output_config: { effort: "medium", format: zodOutputFormat(DraftSchema) },
    });

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
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AIGenerationError("Chiave API dell'assistente non valida.");
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
