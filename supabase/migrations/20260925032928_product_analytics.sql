-- First-party, opt-in aggregate telemetry. No raw person, tenant or object IDs
-- are retained in the count store. Short-lived hashes only prevent duplicates.
create table public.product_usage_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false
);
alter table public.product_usage_preferences enable row level security;
revoke all on public.product_usage_preferences from public,anon,authenticated;
grant select,insert,update on public.product_usage_preferences to authenticated;
create policy own_usage_preference on public.product_usage_preferences for all to authenticated
using (user_id=(select auth.uid()) and (select private.has_required_assurance()))
with check (user_id=(select auth.uid()) and (select private.has_required_assurance()));

create table private.product_usage_counts (
  day date not null,
  event text not null check(event in ('login','ticket_created','ticket_viewed','ticket_updated','ticket_resolved','ticket_reopened','chat_started','chat_message_sent','chat_converted_to_ticket','search_performed','knowledge_article_viewed','asset_viewed')),
  role public.app_role not null,
  surface text not null check(surface in ('workspace','tickets','chat','knowledge','assets')),
  count bigint not null check(count>0),
  primary key(day,event,role,surface)
);
create table private.product_usage_dedup (key text primary key, expires_at timestamptz not null);
create index product_usage_dedup_expiry_idx on private.product_usage_dedup(expires_at);
alter table private.product_usage_counts enable row level security;
alter table private.product_usage_dedup enable row level security;
revoke all on private.product_usage_counts,private.product_usage_dedup from public,anon,authenticated;
grant usage on schema private to service_role;
grant select on private.product_usage_counts to service_role;

create function private.increment_product_usage(org uuid,event_name text,event_surface text,dedup text default null,ttl interval default interval '1 day')
returns void language plpgsql security definer set search_path='' as $$
declare actor_role public.app_role; inserted integer;
begin
  if not exists(select 1 from public.product_usage_preferences where user_id=auth.uid() and enabled) then return; end if;
  select role into actor_role from public.organization_memberships where organization_id=org and user_id=auth.uid() and status='active';
  if actor_role is null or not private.has_required_assurance() then return; end if;
  if dedup is not null then
    delete from private.product_usage_dedup where expires_at<now();
    insert into private.product_usage_dedup(key,expires_at) values(encode(sha256(convert_to(dedup,'UTF8')),'hex'),now()+ttl) on conflict do nothing;
    get diagnostics inserted=row_count;
    if inserted=0 then return; end if;
  end if;
  insert into private.product_usage_counts(day,event,role,surface,count)
  values((now() at time zone 'UTC')::date,event_name,actor_role,event_surface,1)
  on conflict(day,event,role,surface) do update set count=private.product_usage_counts.count+1;
  delete from private.product_usage_counts where day<(now() at time zone 'UTC')::date-365;
exception when others then
  -- Telemetry loss must not roll back a ticket, chat or other user action.
  return;
end $$;
revoke all on function private.increment_product_usage(uuid,text,text,text,interval) from public,anon,authenticated;

create function private.product_mutation_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='tickets' then
    if tg_op='INSERT' then perform private.increment_product_usage(new.organization_id,'ticket_created','tickets');
    elsif (to_jsonb(new)-array['updated_at','first_response_at','response_sla_due_at','resolution_sla_due_at','sla_next_due_at']) is distinct from (to_jsonb(old)-array['updated_at','first_response_at','response_sla_due_at','resolution_sla_due_at','sla_next_due_at']) then
      perform private.increment_product_usage(new.organization_id,'ticket_updated','tickets');
      if old.status not in ('resolved','closed') and new.status in ('resolved','closed') then perform private.increment_product_usage(new.organization_id,'ticket_resolved','tickets'); end if;
      if old.status in ('resolved','closed') and new.status not in ('resolved','closed') then perform private.increment_product_usage(new.organization_id,'ticket_reopened','tickets'); end if;
    end if;
  elsif tg_table_name='chat_conversations' then
    if tg_op='INSERT' then perform private.increment_product_usage(new.organization_id,'chat_started','chat');
    elsif new.ticket_id is distinct from old.ticket_id and new.ticket_id::text=current_setting('app.converted_ticket',true) then perform private.increment_product_usage(new.organization_id,'chat_converted_to_ticket','chat'); end if;
  elsif tg_table_name='chat_messages' and new.kind='message' then
    perform private.increment_product_usage(new.organization_id,'chat_message_sent','chat');
  end if;
  return new;
exception when others then return new;
end $$;
revoke all on function private.product_mutation_event() from public,anon,authenticated;
create trigger product_usage after insert or update on public.tickets for each row execute function private.product_mutation_event();
create trigger product_usage after insert or update on public.chat_conversations for each row execute function private.product_mutation_event();
create trigger product_usage after insert on public.chat_messages for each row execute function private.product_mutation_event();

create function private.record_product_view(event_name text,org uuid,target_id uuid,event_surface text,event_token uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor_role public.app_role; session_key text:=auth.jwt()->>'session_id'; dedup text;
begin
  if auth.uid() is null or session_key is null or not private.has_required_assurance() then return; end if;
  if org is null and event_name='login' then select organization_id into org from public.organization_memberships where user_id=auth.uid() and status='active' order by created_at limit 1; end if;
  select role into actor_role from public.organization_memberships where organization_id=org and user_id=auth.uid() and status='active';
  if actor_role is null then return; end if;
  case event_name
    when 'login' then
      if event_surface<>'workspace' then return; end if;
      dedup:='login:'||session_key;
    when 'ticket_viewed' then
      if event_surface<>'tickets' or not exists(select 1 from public.tickets where id=target_id and organization_id=org and (actor_role<>'end_user' or requester_id=auth.uid())) then return; end if;
      dedup:='ticket_viewed:'||session_key||':'||target_id::text||':'||(now() at time zone 'UTC')::date::text;
    when 'knowledge_article_viewed' then
      if event_surface<>'knowledge' or not exists(select 1 from public.knowledge_articles where id=target_id and organization_id=org and (actor_role<>'end_user' or status='published')) then return; end if;
      dedup:='knowledge_article_viewed:'||session_key||':'||target_id::text||':'||(now() at time zone 'UTC')::date::text;
    when 'search_performed' then
      if event_surface not in ('tickets','knowledge') or event_token is null then return; end if;
      dedup:='search_performed:'||session_key||':'||event_token::text;
    else return; -- Mutation and not-yet-built asset events cannot be forged here.
  end case;
  perform private.increment_product_usage(org,event_name,event_surface,dedup,case when event_name='login' then interval '90 days' else interval '1 day' end);
exception when others then return;
end $$;
revoke all on function private.record_product_view(text,uuid,uuid,text,uuid) from public,anon;
grant execute on function private.record_product_view(text,uuid,uuid,text,uuid) to authenticated;
create function public.record_product_usage(event_name text,event_surface text,org uuid default null,target_id uuid default null,event_token uuid default null)
returns void language sql security invoker set search_path='' as $$select private.record_product_view(event_name,org,target_id,event_surface,event_token);$$;
revoke all on function public.record_product_usage(text,text,uuid,uuid,uuid) from public,anon;
grant execute on function public.record_product_usage(text,text,uuid,uuid,uuid) to authenticated;

create function public.product_usage_summary(days integer default 30)
returns table(day date,event text,role public.app_role,surface text,count bigint)
language sql stable security invoker set search_path='' as $$
  select day,event,role,surface,count from private.product_usage_counts where day >= (now() at time zone 'UTC')::date-(greatest(1,least(coalesce(days,30),366))-1) order by day,event,role,surface;
$$;
revoke all on function public.product_usage_summary(integer) from public,anon,authenticated;
grant execute on function public.product_usage_summary(integer) to service_role;

-- Apply the existing enrolled-MFA read protection to the new audit stream too.
create policy require_enrolled_mfa on public.audit_events as restrictive for select to authenticated using ((select private.has_required_assurance()));

create or replace function public.convert_chat_to_ticket(conversation_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare c public.chat_conversations%rowtype; new_ticket_id uuid; first_message text;
begin
  select * into c from public.chat_conversations where id = conversation_id for update;
  if not found or not (select private.can_work_tickets(c.organization_id)) then raise exception 'Chat not found or access denied'; end if;
  if c.ticket_id is not null then return c.ticket_id; end if;
  select body into first_message from public.chat_messages
    where organization_id = c.organization_id and public.chat_messages.conversation_id = c.id
      and kind = 'message' order by created_at, id limit 1;
  insert into public.tickets (organization_id, requester_id, assigned_technician_id, title, description, status)
  values (c.organization_id, c.requester_id, c.assigned_technician_id, c.topic,
    coalesce(first_message, 'Support chat converted to a ticket.'), 'open') returning id into new_ticket_id;
  perform set_config('app.converted_ticket',new_ticket_id::text,true);
  update public.chat_conversations set ticket_id = new_ticket_id where id = c.id;
  perform set_config('app.converted_ticket','',true);
  return new_ticket_id;
end;
$$;
