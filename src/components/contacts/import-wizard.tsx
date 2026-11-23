"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { FileUpIcon } from "lucide-react";
import { importContacts } from "@/actions/import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  buildRows,
  guessMapping,
  guessNoteColumns,
  humanize,
  looksLikeMetaLeadAds,
  TARGET_FIELDS,
  type Mapping,
  type TargetField,
} from "@/lib/import/mapping";
import { decodeText, parseDelimited, type ParsedTable } from "@/lib/import/parse";

const CHUNK = 200;
const MAX_ROWS = 5000;

interface Done {
  created: number;
  alreadyPresent: number;
}

export function ImportWizard({ slug, firstStageName }: { slug: string; firstStageName: string }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [noteColumns, setNoteColumns] = useState<number[]>([]);
  const [defaultSource, setDefaultSource] = useState("");
  const [extraTags, setExtraTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, start] = useTransition();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setDone(null);
    if (/\.(xlsx?|numbers|ods)$/i.test(file.name)) {
      setError("Per ora si importano file CSV. Da Excel: File → Salva con nome → «CSV UTF-8».");
      return;
    }
    const parsed = parseDelimited(decodeText(await file.arrayBuffer()));
    if (parsed.headers.length < 2 || parsed.rows.length === 0) {
      setError("Non riesco a leggere colonne e righe in questo file. Controlla che sia un CSV con una riga di intestazione.");
      return;
    }
    if (parsed.rows.length > MAX_ROWS) {
      setError(`Il file ha ${parsed.rows.length} righe: il massimo per una singola importazione è ${MAX_ROWS}.`);
      return;
    }
    const guessed = guessMapping(parsed.headers);
    setFileName(file.name);
    setTable(parsed);
    setMapping(guessed);
    setNoteColumns(guessNoteColumns(parsed.headers, guessed));
    setDefaultSource(looksLikeMetaLeadAds(parsed.headers) ? "Meta Lead Ads" : "Importazione da file");
  }

  const result = useMemo(
    () =>
      table
        ? buildRows(table, {
            mapping,
            noteColumns,
            defaultSource,
            extraTags: extraTags.split(",").map((t) => t.trim()).filter(Boolean),
          })
        : null,
    [table, mapping, noteColumns, defaultSource, extraTags],
  );

  function setField(field: TargetField, value: string) {
    setMapping((m) => {
      const next = { ...m };
      if (value === "") delete next[field];
      else next[field] = Number(value);
      return next;
    });
  }

  function toggleNote(index: number) {
    setNoteColumns((cols) => (cols.includes(index) ? cols.filter((c) => c !== index) : [...cols, index].sort((a, b) => a - b)));
  }

  function runImport() {
    if (!result || result.rows.length === 0) return;
    setError(null);
    start(async () => {
      const total: Done = { created: 0, alreadyPresent: 0 };
      for (let i = 0; i < result.rows.length; i += CHUNK) {
        setProgress(i);
        const outcome = await importContacts({ slug, rows: result.rows.slice(i, i + CHUNK) });
        if (!outcome.ok) {
          setError(
            total.created > 0
              ? `${outcome.error} Prima dell'errore sono stati importati ${total.created} contatti: ripetendo l'importazione verranno riconosciuti e saltati.`
              : outcome.error,
          );
          setProgress(null);
          return;
        }
        total.created += outcome.data.created;
        total.alreadyPresent += outcome.data.alreadyPresent;
      }
      setProgress(null);
      setDone(total);
      setTable(null);
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border px-6 py-14 text-center">
        <p className="font-heading text-3xl">{done.created} contatti importati</p>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Sono nella fase «{firstStageName}».
          {done.alreadyPresent > 0 &&
            ` ${done.alreadyPresent} erano già presenti in questa azienda (stessa email) e non sono stati toccati.`}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Link href={`/w/${slug}`} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/85">
            Vedi chi contattare oggi
          </Link>
          <Link href={`/w/${slug}/contacts`} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">
            Apri i contatti
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center transition-colors hover:border-foreground/30 hover:bg-muted/40 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
        <FileUpIcon className="size-6 text-muted-foreground" strokeWidth={1.5} />
        <span className="font-medium">{fileName ?? "Scegli un file CSV"}</span>
        <span className="max-w-md text-sm text-muted-foreground">
          {table
            ? `${table.rows.length} righe, ${table.headers.length} colonne. Scegli un altro file per sostituirlo.`
            : "Vanno bene le esportazioni di Excel, Google Sheets, Meta Lead Ads e di altri CRM. Il file viene letto nel browser: all'app arrivano solo i contatti che confermi."}
        </span>
        <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {table && result && (
        <>
          <section aria-labelledby="map-title">
            <h2 id="map-title" className="text-2xl">
              Corrispondenza delle colonne
            </h2>
            <p className="mt-1.5 mb-6 max-w-xl text-sm text-muted-foreground">
              Ho abbinato le colonne che ho riconosciuto. Controlla e correggi dove serve: basta il nome, tutto il resto è facoltativo.
            </p>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {TARGET_FIELDS.map(({ key, label, hint }) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`map-${key}`}>{label}</Label>
                  <NativeSelect id={`map-${key}`} value={mapping[key] ?? ""} onChange={(e) => setField(key, e.target.value)}>
                    <option value="">Non importare</option>
                    {table.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {humanize(h).slice(0, 70) || `Colonna ${i + 1}`}
                      </option>
                    ))}
                  </NativeSelect>
                  {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="default-source">Fonte, quando manca nel file</Label>
                <Input id="default-source" value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)} maxLength={120} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="extra-tags">Tag da aggiungere a tutti</Label>
                <Input
                  id="extra-tags"
                  value={extraTags}
                  onChange={(e) => setExtraTags(e.target.value)}
                  placeholder="Separati da virgola"
                  maxLength={200}
                  className="h-9"
                />
              </div>
            </div>
          </section>

          <section aria-labelledby="note-title">
            <h2 id="note-title" className="text-2xl">
              Colonne da riportare nella nota
            </h2>
            <p className="mt-1.5 mb-5 max-w-xl text-sm text-muted-foreground">
              Sono le informazioni che il segretario leggerà per scrivere a ciascuno: risposte ai moduli, richieste, date, preferenze.
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {table.headers.map((h, i) =>
                Object.values(mapping).includes(i) || !h ? null : (
                  <li key={i}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm has-checked:border-foreground/30 has-checked:bg-muted/60">
                      <input type="checkbox" className="mt-0.5 accent-primary" checked={noteColumns.includes(i)} onChange={() => toggleNote(i)} />
                      <span className="min-w-0 break-words">{humanize(h)}</span>
                    </label>
                  </li>
                ),
              )}
            </ul>
          </section>

          <section aria-labelledby="preview-title">
            <h2 id="preview-title" className="text-2xl">
              Anteprima
            </h2>
            <p className="mt-1.5 mb-5 text-sm text-muted-foreground">
              {result.rows.length} contatti pronti
              {result.mergedDuplicates > 0 && ` · ${result.mergedDuplicates} righe con la stessa email unite al contatto esistente`}
              {result.skippedNoName > 0 && ` · ${result.skippedNoName} righe senza nome escluse`}
              {result.invalidEmails > 0 && ` · ${result.invalidEmails} email non valide riportate nella nota`}
            </p>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-normal">Nome</th>
                    <th className="px-4 py-2.5 font-normal">Email</th>
                    <th className="px-4 py-2.5 font-normal">Telefono</th>
                    <th className="px-4 py-2.5 font-normal">Nota</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-4 py-3 font-medium whitespace-nowrap">
                        {[r.first_name, r.last_name].filter(Boolean).join(" ")}
                        {r.tags.length > 0 && <span className="mt-1 block text-xs font-normal text-muted-foreground">{r.tags.join(", ")}</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.email ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{r.phone ?? "—"}</td>
                      <td className="max-w-sm px-4 py-3 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
                        {r.note ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.rows.length > 5 && (
              <p className="mt-2 text-xs text-muted-foreground">Mostrati i primi 5 di {result.rows.length}.</p>
            )}
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-6">
            <p className="mr-auto text-sm text-muted-foreground">
              I contatti entrano nella fase «{firstStageName}». Quelli con un&apos;email già presente vengono saltati.
            </p>
            <Button type="button" size="lg" disabled={pending || result.rows.length === 0} onClick={runImport}>
              {pending
                ? `Importazione… ${progress ?? 0} di ${result.rows.length}`
                : `Importa ${result.rows.length} contatti`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
