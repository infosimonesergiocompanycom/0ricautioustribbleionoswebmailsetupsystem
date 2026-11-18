#!/usr/bin/env bash
# Applica la migration a un Postgres locale usa e getta, con uno stub minimo
# dell'ambiente Supabase (schema auth, ruoli, auth.uid()), ed esegue i test RLS.
# Uso: supabase/tests/run.sh   (richiede i binari di PostgreSQL nel PATH o in PGBIN)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb || echo /usr/lib/postgresql/16/bin/initdb)")}"
data="$(mktemp -d)"
port="${PGPORT:-54329}"
trap '"$PGBIN/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data" "$data.log"' EXIT

"$PGBIN/initdb" -D "$data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$data" -o "-p $port -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -w start >"$data.log" 2>&1 || { cat "$data.log"; exit 1; }
psql=("$PGBIN/psql" -h 127.0.0.1 -p "$port" -U postgres -v ON_ERROR_STOP=1 -q)

"${psql[@]}" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase concede i privilegi di tabella ai ruoli API: l'accesso lo decide la RLS.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
SQL

"${psql[@]}" -f "$here/../migrations/0001_init.sql"
"${psql[@]}" -f "$here/rls_isolation.sql"
