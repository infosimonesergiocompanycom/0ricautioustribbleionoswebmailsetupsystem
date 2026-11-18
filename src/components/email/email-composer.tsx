"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CalendarClockIcon, RefreshCwIcon, SendIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { generateDraft, sendEmail } from "@/actions/emails";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EMAIL_KINDS, EMAIL_KIND_ORDER } from "@/lib/ai/email-kinds";
import type { EmailDraft, EmailKind, PipelineStage } from "@/lib/types";
import { cn } from "@/lib/utils";

type ComposerKind = Exclude<EmailKind, "custom">;

const QUICK_FEEDBACK = [
  "Rendila più breve",
  "Sii più formale",
  "Tono più caldo",
  "Cita il nostro ultimo incontro",
  "Proponi due date per una call",
];

const FOLLOW_UP_OPTIONS = [2, 3, 4, 5, 7, 14];

export interface EmailComposerProps {
  slug: string;
  contactId: string;
  contactFirstName: string;
  contactEmail: string | null;
  currentStageId: string;
  stages: PipelineStage[];
  emailConfigured: boolean;
  signature: string | null;
  /** Tipo da generare subito all'apertura (arrivo dalla dashboard). */
  autoStart?: ComposerKind;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Valore per <input type="datetime-local"> nel fuso del browser. */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tomorrowMorning(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d);
}

export function EmailComposer(props: EmailComposerProps) {
  const { slug, contactId, stages, currentStageId, emailConfigured, contactEmail } = props;

  const openStages = stages.filter((s) => s.kind === "open");
  const currentStage = stages.find((s) => s.id === currentStageId);
  // Un lead nella prima fase avanza alla successiva quando riceve la prima email.
  const defaultNextStage =
    currentStage && openStages[0]?.id === currentStage.id && openStages[1] ? openStages[1].id : "";

  const [kind, setKind] = useState<ComposerKind | null>(null);
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nextStageId, setNextStageId] = useState(defaultNextStage);
  // undefined: vale il suggerimento; altrimenti la scelta esplicita dell'utente.
  const [followUpChoice, setFollowUpChoice] = useState<number | "" | undefined>(undefined);
  const [scheduling, setScheduling] = useState(false);
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [generating, startGenerating] = useTransition();
  const [sending, startSending] = useTransition();

  // Il promemoria proposto segue la soglia della fase di destinazione.
  const targetStage = stages.find((s) => s.id === (nextStageId || currentStageId));
  const suggestedFollowUp: number | "" = targetStage?.kind === "open" ? (targetStage.follow_up_days ?? 4) : "";
  const followUpValue = followUpChoice ?? suggestedFollowUp;

  const generate = useCallback(
    (nextKind: ComposerKind, revision?: { draft: EmailDraft; feedback: string }) => {
      setKind(nextKind);
      setError(null);
      startGenerating(async () => {
        const result = await generateDraft({ slug, contactId, kind: nextKind, revision });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDraft(result.data);
        setAiGenerated(true);
        setFeedback("");
      });
    },
    [slug, contactId],
  );

  const started = useRef(false);
  useEffect(() => {
    if (props.autoStart && !started.current) {
      started.current = true;
      generate(props.autoStart);
    }
  }, [props.autoStart, generate]);

  function regenerate(text: string) {
    const instruction = text.trim();
    if (!kind || !draft || !instruction) return;
    generate(kind, { draft, feedback: instruction });
  }

  function writeManually() {
    setKind(null);
    setDraft({ subject: "", body: "" });
    setAiGenerated(false);
    setError(null);
  }

  function submit() {
    if (!draft) return;
    setError(null);

    let scheduledAt: string | null = null;
    if (scheduling) {
      const when = new Date(scheduledLocal);
      if (Number.isNaN(when.getTime())) {
        setError("Scegli data e ora dell'invio programmato.");
        return;
      }
      scheduledAt = when.toISOString();
    }

    let followUpAt: string | null = null;
    if (followUpValue !== "") {
      const base = scheduledAt ? new Date(scheduledAt) : new Date();
      base.setDate(base.getDate() + followUpValue);
      base.setHours(9, 0, 0, 0);
      followUpAt = base.toISOString();
    }

    startSending(async () => {
      const result = await sendEmail({
        slug,
        contactId,
        kind: kind ?? "custom",
        subject: draft.subject,
        body: draft.body,
        aiGenerated,
        scheduledAt,
        nextStageId: nextStageId || null,
        followUpAt,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        result.data.status === "sent" ? `Email inviata a ${props.contactFirstName}` : "Invio programmato",
        { description: followUpAt ? `Promemoria di follow-up tra ${followUpValue} giorni.` : undefined },
      );
      setDraft(null);
      setKind(null);
      setScheduling(false);
    });
  }

  const canSend = Boolean(contactEmail) && emailConfigured;
  const busy = generating || sending;

  return (
    <section aria-labelledby="composer-title" className="rounded-xl border bg-card">
      <header className="border-b px-5 py-4 sm:px-6">
        <h2 id="composer-title" className="flex items-center gap-2 text-xl">
          <SparklesIcon className="size-4 text-muted-foreground" strokeWidth={1.75} />
          Scrivi a {props.contactFirstName}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Il segretario legge profilo del brand, note, storico e fase della trattativa, poi ti propone una bozza da
          rivedere.
        </p>
      </header>

      <div className="space-y-6 px-5 py-5 sm:px-6">
        <div className="grid gap-2 sm:grid-cols-2">
          {EMAIL_KIND_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              disabled={busy}
              aria-pressed={kind === k}
              onClick={() => generate(k)}
              className={cn(
                "rounded-lg border px-3.5 py-2.5 text-left transition-colors outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
                kind === k && "border-foreground/40 bg-muted",
              )}
            >
              <span className="block text-sm font-medium">{EMAIL_KINDS[k].label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{EMAIL_KINDS[k].hint}</span>
            </button>
          ))}
        </div>

        {!draft && !generating && (
          <button
            type="button"
            onClick={writeManually}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Oppure scrivi tu da zero
          </button>
        )}

        {generating && !draft && (
          <div className="space-y-3" role="status" aria-label="Il segretario sta scrivendo">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
            <p className="pt-1 text-sm text-muted-foreground">Il segretario sta scrivendo…</p>
          </div>
        )}

        {draft && (
          <div className={cn("space-y-5 transition-opacity", generating && "opacity-50")}>
            <div className="space-y-2">
              <Label htmlFor="email-subject">Oggetto</Label>
              <Input
                id="email-subject"
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                disabled={busy}
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-body">Testo</Label>
              <Textarea
                id="email-body"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                disabled={busy}
                rows={12}
                className="min-h-64 text-[15px] leading-relaxed"
              />
              {props.signature && (
                <p className="text-xs whitespace-pre-line text-muted-foreground">
                  <span className="block pb-1">In coda verrà aggiunta la firma:</span>
                  {props.signature}
                </p>
              )}
            </div>

            {kind && (
              <div className="space-y-3 rounded-lg bg-muted/60 p-4">
                <p className="text-sm font-medium">Non ti convince? Dillo al segretario</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_FEEDBACK.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={busy}
                      onClick={() => regenerate(q)}
                      className="rounded-full border bg-background px-3 py-1 text-xs transition-colors hover:border-foreground/30 disabled:opacity-60"
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    regenerate(feedback);
                  }}
                >
                  <Input
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Es. accenna al dubbio sul prezzo senza offrire sconti"
                    aria-label="Indicazione per riscrivere la bozza"
                    maxLength={1000}
                    disabled={busy}
                    className="h-9 bg-background"
                  />
                  <Button type="submit" variant="outline" size="lg" disabled={busy || !feedback.trim()}>
                    <RefreshCwIcon className={cn(generating && "animate-spin")} />
                    Rigenera
                  </Button>
                </form>
              </div>
            )}

            <fieldset className="grid gap-4 border-t pt-5 sm:grid-cols-2" disabled={busy}>
              <legend className="sr-only">Dopo l&apos;invio</legend>
              <div className="space-y-2">
                <Label htmlFor="next-stage">A email inviata, sposta in</Label>
                <NativeSelect id="next-stage" value={nextStageId} onChange={(e) => setNextStageId(e.target.value)}>
                  <option value="">Resta in «{currentStage?.name}»</option>
                  {stages
                    .filter((s) => s.id !== currentStageId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="follow-up">Promemoria di follow-up</Label>
                <NativeSelect
                  id="follow-up"
                  value={followUpValue}
                  onChange={(e) => setFollowUpChoice(e.target.value === "" ? "" : Number(e.target.value))}
                >
                  <option value="">Nessun promemoria</option>
                  {FOLLOW_UP_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      Tra {d} giorni
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {scheduling && (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="scheduled-at">Invia il</Label>
                  <Input
                    id="scheduled-at"
                    type="datetime-local"
                    value={scheduledLocal}
                    min={toLocalInput(new Date())}
                    onChange={(e) => setScheduledLocal(e.target.value)}
                    className="h-9 sm:max-w-xs"
                  />
                </div>
              )}
            </fieldset>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {draft && !canSend && (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            {!contactEmail ? (
              "Questo contatto non ha un indirizzo email: puoi preparare la bozza, ma non spedirla."
            ) : (
              <>
                L&apos;invio dal dominio dell&apos;azienda non è ancora configurato.{" "}
                <Link href={`/w/${slug}/settings#email`} className="text-foreground underline underline-offset-4">
                  Completa la configurazione email
                </Link>
                .
              </>
            )}
          </p>
        )}

        {draft && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setKind(null);
                setError(null);
              }}
            >
              Scarta
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={busy}
              onClick={() => {
                setScheduling((v) => !v);
                if (!scheduledLocal) setScheduledLocal(tomorrowMorning());
              }}
            >
              <CalendarClockIcon />
              {scheduling ? "Invia subito, invece" : "Programma"}
            </Button>
            <Button
              type="button"
              size="lg"
              disabled={busy || !canSend || !draft.subject.trim() || !draft.body.trim()}
              onClick={submit}
            >
              <SendIcon />
              {sending ? "Un momento…" : scheduling ? "Conferma programmazione" : "Invia ora"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
