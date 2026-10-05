-- RESTORE ONLY: empty isolated target, after pre-data/data and before post-data.
-- Exclude ONLY TABLE DATA private.automation_version_visibility from the dump
-- restore list first. Retain the complete original backup, including those rows.
-- PostgreSQL transaction IDs are cluster-local. Rebuild this derived visibility
-- metadata as Stage 4 initially did for pre-existing immutable rule versions.
-- Never run on an installed/live schema or use to replay old queued work.
begin;
set local lock_timeout='2s';
do $$
begin
 if (select count(*) from private.automation_processing_state)<>1
   or (select active from private.automation_processing_state) is distinct from false then
  raise exception 'Logical restore requires processing OFF';
 end if;
 if exists(select 1 from private.automation_version_visibility) then
  raise exception 'Logical restore visibility target must be empty';
 end if;
 if exists(select 1 from pg_trigger where tgrelid='private.automation_version_visibility'::regclass and not tgisinternal)
   or exists(select 1 from pg_trigger where tgrelid='public.automation_rule_versions'::regclass and not tgisinternal) then
  raise exception 'Run only before restoring post-data guards';
 end if;
end $$;
insert into private.automation_version_visibility(organization_id,rule_id,version)
 select organization_id,rule_id,version from public.automation_rule_versions;
commit;
-- Next restore all post-data guards/grants/FKs. Validate immutability and OFF.
-- A later authorized activation MUST create a new generation/cutoff. Old events'
-- source snapshots remain untouched and must not be replayed across clusters.
