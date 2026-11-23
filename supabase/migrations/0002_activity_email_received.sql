-- Nuovo tipo di attività per le risposte ricevute dai contatti.
-- In un file a sé: un valore aggiunto a un enum non è utilizzabile nella
-- stessa transazione che lo crea.
alter type public.activity_type add value if not exists 'email_received';
