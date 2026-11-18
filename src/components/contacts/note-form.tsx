"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addNote } from "@/actions/contacts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function NoteForm({ slug, contactId }: { slug: string; contactId: string }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await addNote({ slug, contactId, body });
          if (result.ok) setBody("");
          else toast.error(result.error);
        });
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Nuova nota"
        placeholder="Es. incontrato in fiera, interessato al prodotto X, ha dubbi sul prezzo"
        rows={3}
        maxLength={4000}
      />
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={pending || !body.trim()}>
          {pending ? "Salvataggio…" : "Aggiungi nota"}
        </Button>
      </div>
    </form>
  );
}
