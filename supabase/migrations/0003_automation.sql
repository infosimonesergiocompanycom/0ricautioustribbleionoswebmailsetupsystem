-- =============================================================================
-- Automazione: primo contatto e solleciti inviati senza intervento manuale,
-- interrotti alla prima risposta del contatto.
-- =============================================================================

alter table public.workspaces
  add column automation_enabled    boolean not null default false,
  -- Giorni di silenzio dopo i quali parte un sollecito.
  add column follow_up_after_days  integer not null default 4 check (follow_up_after_days between 1 and 60),
  -- Solleciti dopo il primo contatto; raggiunto il limite, la sequenza si ferma.
  add column max_follow_ups        integer not null default 2 check (max_follow_ups between 0 and 5),
  add column daily_send_limit      integer not null default 150 check (daily_send_limit between 1 and 1000),
  -- Ultima lettura riuscita della casella alla ricerca di risposte.
  add column replies_checked_at    timestamptz,
  add column automation_last_error text;

alter table public.contacts
  add column automation_paused     boolean not null default false,
  add column replied_at            timestamptz,
  -- Email in uscita effettivamente inviate: 0 significa "mai contattato".
  add column outbound_count        integer not null default 0,
  -- Presa in carico da parte di un'esecuzione, per non scrivere due volte alla stessa persona.
  add column automation_claimed_at timestamptz;

create index contacts_automation_idx on public.contacts (workspace_id, outbound_count, last_contacted_at)
  where email is not null and not automation_paused and replied_at is null;

alter table public.emails
  add column automated boolean not null default false;

-- Una risposta letta dalla casella non va registrata due volte.
create unique index emails_message_uidx on public.emails (workspace_id, direction, provider_message_id);

update public.contacts c
set outbound_count = (
  select count(*) from public.emails e
  where e.contact_id = c.id and e.direction = 'outbound' and e.status = 'sent'
);

-- Sostituisce la versione precedente: gestisce anche le email in arrivo.
create or replace function public.handle_email_status()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_type text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  -- Risposta del contatto: storico, fine della sequenza automatica e
  -- promemoria immediato, perché da qui in poi serve una persona.
  if new.direction = 'inbound' then
    if new.status = 'sent' then
      insert into public.activities (workspace_id, contact_id, type, payload, actor_id)
      values (new.workspace_id, new.contact_id, 'email_received',
              jsonb_build_object('email_id', new.id, 'subject', new.subject), null);
      update public.contacts c set
        replied_at     = coalesce(c.replied_at, new.sent_at, now()),
        next_action    = 'Ha risposto: rispondi di persona',
        next_action_at = coalesce(new.sent_at, now())
      where c.id = new.contact_id;
    end if;
    return new;
  end if;

  v_type := case new.status
    when 'scheduled' then 'email_scheduled'
    when 'sent'      then 'email_sent'
    when 'failed'    then 'email_failed'
    else null
  end;

  if v_type is not null then
    insert into public.activities (workspace_id, contact_id, type, payload, actor_id)
    values (new.workspace_id, new.contact_id, v_type::public.activity_type,
            jsonb_build_object('email_id', new.id, 'subject', new.subject, 'kind', new.kind,
                               'scheduled_at', new.scheduled_at, 'error', new.error,
                               'automated', new.automated),
            new.created_by);
  end if;

  if new.status = 'sent' then
    update public.contacts c set
      last_contacted_at     = coalesce(new.sent_at, now()),
      outbound_count        = c.outbound_count + 1,
      automation_claimed_at = null,
      stage_id              = coalesce(new.next_stage_id, c.stage_id),
      next_action           = case when new.next_action_at is not null then new.next_action else null end,
      next_action_at        = new.next_action_at
    where c.id = new.contact_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.handle_email_status() from public, anon;
