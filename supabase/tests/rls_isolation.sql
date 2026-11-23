-- Verifica dell'isolamento tra workspace e dei trigger di storico.
-- Si esegue con supabase/tests/run.sh su un Postgres locale usa e getta.
-- Ogni asserzione fallita interrompe lo script.

\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com',   '{"full_name":"Bob"}');

set role authenticated;

-- Alice crea due workspace, Bob uno.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select set_config('test.ws_a',  (public.create_workspace('Atelier Alice')).id::text, false);
select set_config('test.ws_a2', (public.create_workspace('Atelier Alice')).id::text, false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select set_config('test.ws_b',  (public.create_workspace('Studio Bob')).id::text, false);

-- Alice lavora nel proprio workspace.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare
  v_ws      uuid := current_setting('test.ws_a')::uuid;
  v_ws2     uuid := current_setting('test.ws_a2')::uuid;
  v_stage0  uuid;
  v_stage1  uuid;
  v_foreign uuid;
  v_contact uuid;
  v_email   uuid;
  c         public.contacts;
begin
  assert (select count(*) from public.workspaces) = 2, 'Alice vede i suoi due workspace';
  assert (select count(distinct slug) from public.workspaces) = 2, 'slug univoci anche a parità di nome';
  assert (select count(*) from public.pipeline_stages) = 12, 'sei fasi di default per workspace';

  select id into v_stage0 from public.pipeline_stages where workspace_id = v_ws and position = 0;
  select id into v_stage1 from public.pipeline_stages where workspace_id = v_ws and position = 1;
  select id into v_foreign from public.pipeline_stages where workspace_id = v_ws2 and position = 0;

  insert into public.contacts (workspace_id, stage_id, first_name, email, created_by)
  values (v_ws, v_stage0, 'Carla', 'carla@cliente.it', auth.uid()) returning id into v_contact;
  perform set_config('test.contact_a', v_contact::text, false);

  insert into public.contact_notes (workspace_id, contact_id, body, created_by)
  values (v_ws, v_contact, 'Incontrata in fiera', auth.uid());

  -- FK composita: niente fase di un altro workspace, nemmeno se appartiene allo stesso utente.
  begin
    insert into public.contacts (workspace_id, stage_id, first_name) values (v_ws, v_foreign, 'Intruso');
    raise exception 'attesa violazione di chiave esterna';
  exception when foreign_key_violation then null;
  end;

  -- Email duplicata nello stesso workspace (case-insensitive).
  begin
    insert into public.contacts (workspace_id, stage_id, first_name, email)
    values (v_ws, v_stage0, 'Doppione', 'CARLA@cliente.it');
    raise exception 'attesa violazione di unicità';
  exception when unique_violation then null;
  end;

  -- Email inviata: ultimo contatto, avanzamento di fase e promemoria.
  insert into public.emails (workspace_id, contact_id, status, subject, body, to_email,
                             next_stage_id, next_action, next_action_at, created_by)
  values (v_ws, v_contact, 'sending', 'Oggetto', 'Corpo', 'carla@cliente.it',
          v_stage1, 'Follow-up', now() + interval '4 days', auth.uid())
  returning id into v_email;
  update public.emails set status = 'sent', sent_at = now() where id = v_email;

  select * into c from public.contacts where id = v_contact;
  assert c.stage_id = v_stage1, 'la fase avanza dopo l''invio';
  assert c.last_contacted_at is not null, 'ultimo contatto valorizzato';
  assert c.next_action = 'Follow-up' and c.next_action_at is not null, 'promemoria impostato';
  assert c.outbound_count = 1, 'conteggio delle email inviate';

  -- Risposta del contatto: la sequenza si ferma e nasce un promemoria.
  insert into public.emails (workspace_id, contact_id, direction, status, subject, body, to_email, sent_at, provider_message_id)
  values (v_ws, v_contact, 'inbound', 'sent', 'Re: Oggetto', 'Grazie', 'info@example.com', now(), '<msg-1@example.com>');
  select * into c from public.contacts where id = v_contact;
  assert c.replied_at is not null, 'risposta registrata';
  assert c.next_action like 'Ha risposto%', 'promemoria alla risposta';
  assert c.outbound_count = 1, 'una risposta non conta come invio';
  begin
    insert into public.emails (workspace_id, contact_id, direction, status, subject, body, to_email, provider_message_id)
    values (v_ws, v_contact, 'inbound', 'sent', 'Re: Oggetto', 'Grazie', 'info@example.com', '<msg-1@example.com>');
    raise exception 'attesa violazione di unicità';
  exception when unique_violation then null;
  end;

  assert (select array_agg(type::text order by type::text) from public.activities where contact_id = v_contact)
       = array['contact_created','email_received','email_sent','next_action_set','next_action_set','note_added','stage_changed'],
       'storico completo';

  -- Lo storico non è scrivibile dai client.
  begin
    insert into public.activities (workspace_id, contact_id, type) values (v_ws, v_contact, 'note_added');
    raise exception 'attesa violazione RLS';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Bob: nessuna visibilità e nessuna scrittura sui dati di Alice.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
declare
  v_ws_a    uuid := current_setting('test.ws_a')::uuid;
  v_contact uuid := current_setting('test.contact_a')::uuid;
  v_stage_b uuid;
  n         integer;
begin
  assert (select count(*) from public.workspaces) = 1, 'Bob vede solo il proprio workspace';
  assert (select count(*) from public.pipeline_stages) = 6, 'Bob vede solo le proprie fasi';
  assert (select count(*) from public.contacts) = 0, 'contatti di Alice invisibili';
  assert (select count(*) from public.contact_notes) = 0, 'note di Alice invisibili';
  assert (select count(*) from public.emails) = 0, 'email di Alice invisibili';
  assert (select count(*) from public.activities) = 0, 'storico di Alice invisibile';
  assert (select count(*) from public.profiles) = 1, 'profili altrui invisibili';
  assert (select count(*) from public.workspace_members) = 1, 'membership altrui invisibili';

  select id into v_stage_b from public.pipeline_stages where position = 0;

  begin
    insert into public.contact_notes (workspace_id, contact_id, body) values (v_ws_a, v_contact, 'intrusione');
    raise exception 'attesa violazione RLS';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.workspace_members (workspace_id, user_id, role) values (v_ws_a, auth.uid(), 'admin');
    raise exception 'attesa violazione RLS';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.workspace_email_settings (workspace_id, provider, from_name, from_email)
    values (v_ws_a, 'resend', 'Bob', 'bob@example.com');
    raise exception 'attesa violazione RLS';
  exception when insufficient_privilege then null;
  end;

  update public.contacts set first_name = 'Manomesso' where id = v_contact;
  get diagnostics n = row_count;
  assert n = 0, 'update su contatti altrui senza effetto';

  update public.workspaces set name = 'Preso' where id = v_ws_a;
  get diagnostics n = row_count;
  assert n = 0, 'update su workspace altrui senza effetto';

  delete from public.contacts where id = v_contact;
  get diagnostics n = row_count;
  assert n = 0, 'delete su contatti altrui senza effetto';
end $$;

-- Utente non autenticato: nessun accesso.
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  begin
    perform count(*) from public.contacts;
    raise exception 'attesa mancanza di privilegi';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_workspace('Anonimo');
    raise exception 'attesa mancanza di privilegi';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'Isolamento verificato: tutte le asserzioni superate' as esito;
