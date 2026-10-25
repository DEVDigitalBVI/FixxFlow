-- 20261025011822_knowledge_article_audiences rebuilt record_product_view from a copy
-- that predated asset tracking, dropping the asset_viewed branch. Restore it while
-- keeping the employee-facing audience rule for knowledge article views.
create or replace function private.record_product_view(event_name text,org uuid,target_id uuid,event_surface text,event_token uuid)
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
      if event_surface<>'knowledge' or not exists(select 1 from public.knowledge_articles where id=target_id and organization_id=org and (actor_role<>'end_user' or (status='published' and audience='employees'))) then return; end if;
      dedup:='knowledge_article_viewed:'||session_key||':'||target_id::text||':'||(now() at time zone 'UTC')::date::text;
    when 'asset_viewed' then
      if event_surface<>'assets' or not exists(select 1 from public.assets where id=target_id and organization_id=org and (actor_role<>'end_user' or assigned_user_id=auth.uid())) then return; end if;
      dedup:='asset_viewed:'||session_key||':'||target_id::text||':'||(now() at time zone 'UTC')::date::text;
    when 'search_performed' then
      if event_surface not in ('tickets','knowledge') or event_token is null then return; end if;
      dedup:='search_performed:'||session_key||':'||event_token::text;
    else return; -- Mutation events cannot be forged here.
  end case;
  perform private.increment_product_usage(org,event_name,event_surface,dedup,case when event_name='login' then interval '90 days' else interval '1 day' end);
exception when others then return;
end $$;
