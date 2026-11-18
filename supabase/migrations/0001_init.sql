-- =============================================================================
-- CRM multi-tenant · schema iniziale
--
-- Principio di isolamento: ogni riga applicativa porta un workspace_id e ogni
-- tabella ha RLS attiva. L'accesso passa sempre da is_workspace_member().
-- Le chiavi esterne composite (workspace_id, id) impediscono a livello di
-- database che un record punti a un oggetto di un altro workspace.
-- =============================================================================

create extension if not exists citext;

-- -----------------------------------------------------------------------------
-- Tipi
-- -----------------------------------------------------------------------------
create type public.workspace_role  as enum ('owner', 'admin', 'member');
create type public.stage_kind      as enum ('open', 'won', 'lost');
create type public.email_provider  as enum ('resend', 'sendgrid', 'smtp');
create type public.email_kind      as enum ('first_contact', 'soft_follow_up', 'case_study', 'closing_call', 'custom');
create type public.email_status    as enum ('scheduled', 'sending', 'sent', 'failed', 'cancelled');
create type public.email_direction as enum ('outbound', 'inbound');
create type public.activity_type   as enum (
  'contact_created', 'note_added', 'stage_changed',
  'email_scheduled', 'email_sent', 'email_failed', 'next_action_set'
);

-- -----------------------------------------------------------------------------
-- Profili (specchio di auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      citext not null,
  full_name  text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Workspace (azienda / brand) con il relativo Brand Context
-- -----------------------------------------------------------------------------
create table public.workspaces (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name           text not null check (length(trim(name)) between 1 and 120),
  industry       text,
  website        text,
  description    text,            -- prodotti / servizi
  tone_of_voice  text,            -- istruzioni di stile per l'assistente
  email_examples text,            -- email già scritte, usate come riferimento di stile
  signature      text,            -- firma in coda a ogni email
  language       text not null default 'it',
  created_by     uuid not null references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.workspace_role not null default 'member',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Configurazione di invio. Il segreto (API key o password SMTP) è cifrato
-- dall'applicazione con AES-256-GCM: nel database transita solo il ciphertext.
create table public.workspace_email_settings (
  workspace_id      uuid primary key references public.workspaces (id) on delete cascade,
  provider          public.email_provider not null,
  from_name         text not null,
  from_email        citext not null,
  reply_to          citext,
  smtp_host         text,
  smtp_port         integer check (smtp_port between 1 and 65535),
  smtp_user         text,
  secret_ciphertext text,
  updated_at        timestamptz not null default now(),
  check (provider <> 'smtp' or (smtp_host is not null and smtp_port is not null and smtp_user is not null))
);

-- -----------------------------------------------------------------------------
-- Pipeline
-- -----------------------------------------------------------------------------
create table public.pipeline_stages (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 60),
  position       integer not null,
  kind           public.stage_kind not null default 'open',
  -- Dopo quanti giorni di silenzio il segretario propone di ricontattare.
  -- NULL: la fase non genera promemoria (tipicamente le fasi chiuse).
  follow_up_days integer check (follow_up_days > 0),
  -- Tipo di email suggerito per i contatti fermi in questa fase.
  suggested_kind public.email_kind not null default 'soft_follow_up',
  created_at     timestamptz not null default now(),
  unique (workspace_id, id)
);
create index pipeline_stages_ws_idx on public.pipeline_stages (workspace_id, position);

-- -----------------------------------------------------------------------------
-- Contatti
-- -----------------------------------------------------------------------------
create table public.contacts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  stage_id          uuid not null,
  first_name        text not null check (length(trim(first_name)) > 0),
  last_name         text,
  email             citext,
  phone             text,
  company           text,
  job_title         text,
  source            text,
  tags              text[] not null default '{}',
  last_contacted_at timestamptz,
  next_action       text,
  next_action_at    timestamptz,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, stage_id) references public.pipeline_stages (workspace_id, id)
);
create index contacts_ws_stage_idx on public.contacts (workspace_id, stage_id);
create index contacts_ws_next_action_idx on public.contacts (workspace_id, next_action_at);
create index contacts_tags_idx on public.contacts using gin (tags);
-- Un indirizzo email identifica un solo contatto per workspace (utile anche
-- per la deduplica in importazione).
create unique index contacts_ws_email_uidx on public.contacts (workspace_id, email) where email is not null;

create table public.contact_notes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  contact_id   uuid not null,
  body         text not null check (length(trim(body)) > 0),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade
);
create index contact_notes_contact_idx on public.contact_notes (contact_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Email (storico e invii programmati)
-- -----------------------------------------------------------------------------
create table public.emails (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  contact_id          uuid not null,
  direction           public.email_direction not null default 'outbound',
  kind                public.email_kind not null default 'custom',
  status              public.email_status not null,
  subject             text not null check (length(trim(subject)) > 0),
  body                text not null check (length(trim(body)) > 0),
  to_email            citext not null,
  ai_generated        boolean not null default false,
  scheduled_at        timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  error               text,
  -- Effetti da applicare al contatto nel momento in cui l'email risulta inviata.
  next_stage_id       uuid,
  next_action         text,
  next_action_at      timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade,
  foreign key (workspace_id, next_stage_id) references public.pipeline_stages (workspace_id, id),
  check (status <> 'scheduled' or scheduled_at is not null)
);
create index emails_contact_idx on public.emails (contact_id, created_at desc);
create index emails_due_idx on public.emails (scheduled_at) where status = 'scheduled';

-- -----------------------------------------------------------------------------
-- Storico attività (append-only, scritto esclusivamente dai trigger)
-- -----------------------------------------------------------------------------
create table public.activities (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  contact_id   uuid not null,
  type         public.activity_type not null,
  payload      jsonb not null default '{}',
  actor_id     uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade
);
create index activities_contact_idx on public.activities (contact_id, created_at desc);

-- =============================================================================
-- Funzioni di supporto
-- =============================================================================

create function public.is_workspace_member(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

create function public.is_workspace_admin(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

create function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger email_settings_updated_at before update on public.workspace_email_settings
  for each row execute function public.set_updated_at();
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
create trigger emails_updated_at before update on public.emails
  for each row execute function public.set_updated_at();

-- Profilo creato alla registrazione.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Creazione atomica di un workspace: riga, membership "owner" e fasi di default.
create function public.create_workspace(
  p_name        text,
  p_industry    text default null,
  p_website     text default null,
  p_description text default null
)
returns public.workspaces
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_base text;
  v_slug text;
  v_ws   public.workspaces;
begin
  if v_uid is null then
    raise exception 'Autenticazione richiesta' using errcode = '42501';
  end if;

  v_base := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then
    v_base := 'workspace';
  end if;
  v_slug := v_base;
  while exists (select 1 from public.workspaces w where w.slug = v_slug) loop
    v_slug := v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5);
  end loop;

  insert into public.workspaces (slug, name, industry, website, description, created_by)
  values (v_slug, trim(p_name), nullif(trim(p_industry), ''), nullif(trim(p_website), ''),
          nullif(trim(p_description), ''), v_uid)
  returning * into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws.id, v_uid, 'owner');

  insert into public.pipeline_stages (workspace_id, name, position, kind, follow_up_days, suggested_kind) values
    (v_ws.id, 'Nuovo Lead',                        0, 'open', 1,    'first_contact'),
    (v_ws.id, 'Contattato',                        1, 'open', 4,    'soft_follow_up'),
    (v_ws.id, 'In Trattativa / Proposta Inviata',  2, 'open', 3,    'closing_call'),
    (v_ws.id, 'Follow-up',                         3, 'open', 5,    'soft_follow_up'),
    (v_ws.id, 'Chiuso Vinto',                      4, 'won',  null, 'custom'),
    (v_ws.id, 'Chiuso Perso',                      5, 'lost', null, 'custom');

  return v_ws;
end;
$$;

-- -----------------------------------------------------------------------------
-- Trigger dello storico attività
-- -----------------------------------------------------------------------------
create function public.log_contact_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activities (workspace_id, contact_id, type, payload, actor_id)
    values (new.workspace_id, new.id, 'contact_created',
            jsonb_build_object('source', new.source), (select auth.uid()));
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id then
    insert into public.activities (workspace_id, contact_id, type, payload, actor_id)
    values (new.workspace_id, new.id, 'stage_changed',
            jsonb_build_object(
              'from', (select s.name from public.pipeline_stages s where s.id = old.stage_id),
              'to',   (select s.name from public.pipeline_stages s where s.id = new.stage_id)),
            (select auth.uid()));
  end if;

  if new.next_action_at is distinct from old.next_action_at and new.next_action_at is not null then
    insert into public.activities (workspace_id, contact_id, type, payload, actor_id)
    values (new.workspace_id, new.id, 'next_action_set',
            jsonb_build_object('action', new.next_action, 'due_at', new.next_action_at),
            (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger contacts_activity after insert or update on public.contacts
  for each row execute function public.log_contact_activity();

create function public.log_note_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.activities (workspace_id, contact_id, type, payload, actor_id)
  values (new.workspace_id, new.contact_id, 'note_added',
          jsonb_build_object('note_id', new.id, 'body', new.body), new.created_by);
  return new;
end;
$$;

create trigger contact_notes_activity after insert on public.contact_notes
  for each row execute function public.log_note_activity();

-- Quando un'email cambia stato: storico, data di ultimo contatto, avanzamento
-- di fase e promemoria. Vale allo stesso modo per l'invio immediato e per
-- quello programmato, che viene eseguito dal job senza utente collegato.
create function public.handle_email_status()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_type public.activity_type;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  v_type := case new.status
    when 'scheduled' then 'email_scheduled'
    when 'sent'      then 'email_sent'
    when 'failed'    then 'email_failed'
    else null
  end::public.activity_type;

  if v_type is not null then
    insert into public.activities (workspace_id, contact_id, type, payload, actor_id)
    values (new.workspace_id, new.contact_id, v_type,
            jsonb_build_object('email_id', new.id, 'subject', new.subject, 'kind', new.kind,
                               'scheduled_at', new.scheduled_at, 'error', new.error),
            new.created_by);
  end if;

  if new.status = 'sent' and new.direction = 'outbound' then
    update public.contacts c set
      last_contacted_at = coalesce(new.sent_at, now()),
      stage_id          = coalesce(new.next_stage_id, c.stage_id),
      next_action       = case when new.next_action_at is not null then new.next_action else null end,
      next_action_at    = new.next_action_at
    where c.id = new.contact_id;
  end if;
  return new;
end;
$$;

create trigger emails_status after insert or update of status on public.emails
  for each row execute function public.handle_email_status();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles                 enable row level security;
alter table public.workspaces               enable row level security;
alter table public.workspace_members        enable row level security;
alter table public.workspace_email_settings enable row level security;
alter table public.pipeline_stages          enable row level security;
alter table public.contacts                 enable row level security;
alter table public.contact_notes            enable row level security;
alter table public.emails                   enable row level security;
alter table public.activities               enable row level security;

-- Profili: ciascuno vede e modifica il proprio.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Workspace: visibili ai membri; la creazione passa da create_workspace().
create policy workspaces_select on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = workspaces.id and m.user_id = (select auth.uid()) and m.role = 'owner'));

create policy members_select on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy members_insert on public.workspace_members for insert to authenticated
  with check (public.is_workspace_admin(workspace_id) and role <> 'owner');
create policy members_delete on public.workspace_members for delete to authenticated
  using (public.is_workspace_admin(workspace_id) and role <> 'owner');

-- Configurazione email: i membri la leggono (serve per inviare; il segreto è
-- cifrato con una chiave che vive solo nell'applicazione), la gestiscono
-- owner e admin.
create policy email_settings_select on public.workspace_email_settings for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy email_settings_insert on public.workspace_email_settings for insert to authenticated
  with check (public.is_workspace_admin(workspace_id));
create policy email_settings_update on public.workspace_email_settings for update to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
create policy email_settings_delete on public.workspace_email_settings for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

-- Fasi: lettura per i membri, gestione per owner e admin.
create policy stages_select on public.pipeline_stages for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy stages_insert on public.pipeline_stages for insert to authenticated
  with check (public.is_workspace_admin(workspace_id));
create policy stages_update on public.pipeline_stages for update to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
create policy stages_delete on public.pipeline_stages for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

-- Dati operativi: pieno accesso ai membri del workspace, nessuno agli altri.
create policy contacts_all on public.contacts for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy notes_all on public.contact_notes for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy emails_all on public.emails for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

-- Storico: sola lettura. Le scritture arrivano dai trigger (security definer).
create policy activities_select on public.activities for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- -----------------------------------------------------------------------------
-- Privilegi
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;
grant execute on function public.create_workspace(text, text, text, text) to authenticated;
