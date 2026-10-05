alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check(action in ('created','updated','deleted','enabled','disabled'));

-- Keep automation summaries in the existing append-only administrator audit.
-- Definitions, descriptions, condition values, note bodies and configurations
-- are deliberately excluded; exact definitions live only in version history.
create function private.record_automation_administration_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_action text; actor_label text; delta jsonb;
begin
  if tg_op='INSERT' then event_action:='created';
  elsif new.archived_at is not null and old.archived_at is null then event_action:='deleted';
  elsif new.enabled is distinct from old.enabled then event_action:=case when new.enabled then 'enabled' else 'disabled' end;
  else event_action:='updated'; end if;
  select display_name into actor_label from public.profiles where organization_id=new.organization_id and user_id=auth.uid();
  delta:=jsonb_build_array(jsonb_build_object('field','version','from',case when tg_op='INSERT' then null else old.version end,'to',new.version),
    jsonb_build_object('field','enabled','from',case when tg_op='INSERT' then null else old.enabled end,'to',new.enabled));
  if event_action='deleted' then delta:=delta||jsonb_build_array(jsonb_build_object('field','archived','from',false,'to',true)); end if;
  insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
  values(new.organization_id,auth.uid(),coalesce(actor_label,'Member '||auth.uid()::text),'automation_rules',new.id,new.name,event_action,delta);
  return new;
end $$;
revoke all on function private.record_automation_administration_audit() from public,anon,authenticated,service_role;
create trigger automation_rules_audit after insert or update on public.automation_rules for each row execute function private.record_automation_administration_audit();
