"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { PlayIcon, RefreshCwIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";
import { checkRepliesNow, runAutomationNow } from "@/actions/automation";
import { Button } from "@/components/ui/button";
import type { AutomationOverview } from "@/lib/automation/engine";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AutomationPanel({
  slug,
  enabled,
  overview,
  lastError,
  repliesCheckedAt,
}: {
  slug: string;
  enabled: boolean;
  overview: AutomationOverview;
  lastError: string | null;
  repliesCheckedAt: string | null;
}) {
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stop, setStop] = useState(false);
  const [checking, startChecking] = useTransition();
  const stopRef = useRef(false);

  const toSend = overview.awaitingFirst + (overview.followUpsBlocked ? 0 : overview.followUpsDue);

  async function run(single = false) {
    setRunning(true);
    setError(null);
    setSent(0);
    setStop(false);
    stopRef.current = false;
    let total = 0;
    // Un gruppo alla volta: ogni chiamata resta breve e l'avanzamento è visibile.
    for (;;) {
      const result = await runAutomationNow(slug, single);
      if (!result.ok) {
        setError(result.error);
        break;
      }
      total += result.data.sent;
      setSent(total);
      if (result.data.error) {
        setError(result.data.error);
        break;
      }
      if (single || result.data.remaining === 0 || result.data.sent === 0 || stopRef.current) break;
    }
    setRunning(false);
    if (total > 0) {
      toast.success(single ? "Email di prova inviata: aprila dai contatti per controllarla" : `${total} email inviate`);
    }
  }

  const stats = [
    { label: "In attesa del primo contatto", value: overview.awaitingFirst },
    { label: "Solleciti da inviare ora", value: overview.followUpsDue },
    { label: "In attesa di risposta", value: overview.waiting },
    { label: "Hanno risposto", value: overview.replied },
    { label: "Senza risposta, sequenza finita", value: overview.exhausted },
  ];

  if (!enabled) {
    return (
      <section className="rounded-xl border border-dashed px-6 py-6">
        <h2 className="text-xl">Automazione spenta</h2>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
          Quando è accesa, il segretario scrive e invia da solo il primo contatto e i solleciti, e si ferma appena una
          persona risponde.
        </p>
        <Link
          href={`/w/${slug}/settings#automation`}
          className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/85"
        >
          Configura l&apos;automazione
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="automation-title" className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div>
          <h2 id="automation-title" className="flex items-center gap-2.5 text-xl">
            <span className="size-2 rounded-full bg-emerald-600" aria-hidden />
            Automazione attiva
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {overview.sentToday} email inviate oggi in automatico.
            {repliesCheckedAt ? ` Casella letta il ${formatDateTime(repliesCheckedAt)}.` : " Casella non ancora letta."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={checking || running}
            onClick={() =>
              startChecking(async () => {
                const result = await checkRepliesNow(slug);
                if (result.ok) toast.success("Casella letta");
                else setError(result.error);
              })
            }
          >
            <RefreshCwIcon className={cn(checking && "animate-spin")} />
            Controlla risposte
          </Button>
          {running ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                setStop(true);
                stopRef.current = true;
              }}
            >
              <SquareIcon />
              {stop ? "Mi fermo dopo questo gruppo…" : `Ferma (${sent} inviate)`}
            </Button>
          ) : (
            <>
              {toSend > 1 && (
                <Button type="button" variant="outline" size="lg" onClick={() => run(true)}>
                  Prova con 1
                </Button>
              )}
              <Button type="button" size="lg" disabled={toSend === 0} onClick={() => run()}>
                <PlayIcon />
                {toSend === 0 ? "Niente da inviare ora" : `Invia ora a ${toSend}`}
              </Button>
            </>
          )}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-5 sm:px-6">
        {stats.map((s) => (
          <div key={s.label}>
            <dd className="font-heading text-3xl tabular-nums">{s.value}</dd>
            <dt className="mt-1 text-xs leading-snug text-muted-foreground">{s.label}</dt>
          </div>
        ))}
      </dl>

      {(error || lastError || overview.followUpsBlocked) && (
        <div className="space-y-2 border-t px-5 py-4 text-sm sm:px-6">
          {(error ?? lastError) && (
            <p role="alert" className="text-destructive">
              {error ?? lastError}
            </p>
          )}
          {overview.followUpsBlocked && overview.followUpsDue > 0 && (
            <p className="text-muted-foreground">{overview.followUpsBlocked}</p>
          )}
        </div>
      )}
    </section>
  );
}
