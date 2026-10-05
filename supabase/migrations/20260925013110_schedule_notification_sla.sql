-- Supabase supplies pg_cron; other local Postgres engines can use the HTTP cron instead.
do $$ begin
 if exists (select 1 from pg_available_extensions where name='pg_cron') then
   create extension if not exists pg_cron;
   perform cron.schedule('fixxflow-sla-notifications','* * * * *','select public.enqueue_sla_notifications()');
 end if;
end $$;
