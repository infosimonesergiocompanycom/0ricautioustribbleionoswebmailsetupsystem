// Applica le migration SQL di supabase/migrations al database, una sola volta
// ciascuna. Viene eseguito prima di ogni build: su Vercel la stringa di
// connessione arriva dall'integrazione Supabase (POSTGRES_URL_NON_POOLING).
// Senza stringa di connessione (build locale) non fa nulla.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const raw = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
if (!raw) {
  console.log("[migrate] nessuna stringa di connessione: migration saltate.");
  process.exit(0);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

// La modalità SSL si imposta qui sotto: il parametro nell'URL avrebbe la precedenza.
const url = new URL(raw);
url.searchParams.delete("sslmode");
const local = ["localhost", "127.0.0.1"].includes(url.hostname);

const client = new pg.Client({
  connectionString: url.toString(),
  // La connessione è cifrata. Il certificato di Supabase è firmato da una CA
  // propria, assente dall'archivio di sistema, quindi la catena non è verificata.
  ssl: local ? false : { rejectUnauthorized: false },
});

await client.connect();
try {
  // Un lock evita che due build contemporanee applichino la stessa migration.
  await client.query("select pg_advisory_lock(727274001)");
  // Schema separato da "public": non è esposto dalle API di Supabase.
  await client.query("create schema if not exists app_private");
  await client.query(
    "create table if not exists app_private.migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const { rows } = await client.query("select name from app_private.migrations");
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    console.log(`[migrate] applico ${file}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into app_private.migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  console.log("[migrate] database aggiornato.");
} finally {
  await client.end();
}
