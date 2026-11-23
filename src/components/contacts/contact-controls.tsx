"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteContact, setAutomationPaused } from "@/actions/automation";

export function ContactControls({
  slug,
  contactId,
  paused,
  replied,
}: {
  slug: string;
  contactId: string;
  paused: boolean;
  replied: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-8 space-y-4 border-t pt-6 text-sm">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 accent-primary"
          checked={paused}
          disabled={pending}
          onChange={(e) =>
            start(async () => {
              const result = await setAutomationPaused({ slug, contactId, paused: e.target.checked });
              if (!result.ok) toast.error(result.error);
            })
          }
        />
        <span>
          Escludi dall&apos;automazione
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {replied
              ? "Ha già risposto: la sequenza automatica è comunque ferma."
              : "Non riceverà né il primo contatto né i solleciti automatici."}
          </span>
        </span>
      </label>

      {confirming ? (
        <div className="space-y-2 rounded-lg bg-destructive/10 p-3">
          <p>Eliminare il contatto con note, email e storico? Non si può annullare.</p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={pending}
              className="font-medium text-destructive underline-offset-4 hover:underline"
              onClick={() =>
                start(async () => {
                  const result = await deleteContact({ slug, contactId });
                  if (result && !result.ok) toast.error(result.error);
                })
              }
            >
              {pending ? "Eliminazione…" : "Sì, elimina"}
            </button>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setConfirming(false)}>
              Annulla
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:text-destructive hover:underline"
          onClick={() => setConfirming(true)}
        >
          Elimina contatto
        </button>
      )}
    </div>
  );
}
