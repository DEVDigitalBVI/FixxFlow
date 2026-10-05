-- Transactional fixture only: no invitations, content exports, or retained events.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated','aal','aal2','session_id',gen_random_uuid())::text,true),set_config('app.test_org',organization_id::text,true)
from public.organization_memberships where role='administrator' and status='active' limit 1;
do $$
declare org uuid:=current_setting('app.test_org')::uuid; t uuid; c uuid; linked uuid; baseline bigint; captured bigint; initial_count bigint;
begin
  select coalesce(sum(count),0) into baseline from private.product_usage_counts;
  -- No preference is opt-out. An explicit false remains opt-out.
  insert into public.product_usage_preferences(user_id,enabled) values(auth.uid(),false) on conflict(user_id) do update set enabled=false;
  insert into public.tickets(organization_id,requester_id,title,description) values(org,auth.uid(),'Usage fixture','PRIVATE_CONTENT') returning id into t;
  if (select coalesce(sum(count),0) from private.product_usage_counts)<>baseline then raise exception 'Opt-out ignored'; end if;
  update public.product_usage_preferences set enabled=true where user_id=auth.uid();
  select coalesce(sum(count),0) into initial_count from private.product_usage_counts where event='ticket_viewed';
  perform public.record_product_usage('ticket_viewed','tickets',org,t);
  perform public.record_product_usage('ticket_viewed','tickets',org,t);
  if (select coalesce(sum(count),0) from private.product_usage_counts where event='ticket_viewed')<>initial_count+1 then raise exception 'View deduplication failed'; end if;
  select coalesce(sum(count),0) into initial_count from private.product_usage_counts where event='login';
  perform public.record_product_usage('login','workspace');
  perform public.record_product_usage('login','workspace');
  if (select coalesce(sum(count),0) from private.product_usage_counts where event='login')<>initial_count+1 then raise exception 'Login session deduplication failed'; end if;
  select coalesce(sum(count),0) into initial_count from private.product_usage_counts where event='search_performed';
  perform public.record_product_usage('search_performed','tickets',org,null,gen_random_uuid());
  if (select coalesce(sum(count),0) from private.product_usage_counts where event='search_performed')<>initial_count+1 then raise exception 'Search not counted'; end if;
  select coalesce(sum(count),0) into captured from private.product_usage_counts;
  perform public.record_product_usage('ticket_created','tickets',org,t);
  perform public.record_product_usage('asset_viewed','assets',org,t);
  perform public.record_product_usage('ticket_viewed','tickets',gen_random_uuid(),t);
  if (select coalesce(sum(count),0) from private.product_usage_counts)<>captured then raise exception 'Forged or unauthorized event accepted'; end if;
  select coalesce(sum(count),0) into initial_count from private.product_usage_counts where event='ticket_resolved';
  update public.tickets set status='resolved' where id=t;
  if (select coalesce(sum(count),0) from private.product_usage_counts where event='ticket_resolved')<>initial_count+1 then raise exception 'Resolution not counted'; end if;
  select coalesce(sum(count),0) into initial_count from private.product_usage_counts where event='ticket_reopened';
  update public.tickets set status='open' where id=t;
  if (select coalesce(sum(count),0) from private.product_usage_counts where event='ticket_reopened')<>initial_count+1 then raise exception 'Reopen not counted'; end if;
  select coalesce(sum(count),0) into captured from private.product_usage_counts;
  update public.tickets set status='open' where id=t;
  if (select coalesce(sum(count),0) from private.product_usage_counts)<>captured then raise exception 'No-op counted'; end if;
  c:=public.start_support_chat(org,'Usage test chat','PRIVATE_CHAT_CONTENT');
  select coalesce(sum(count),0) into initial_count from private.product_usage_counts where event='chat_converted_to_ticket';
  linked:=public.convert_chat_to_ticket(c);
  perform public.convert_chat_to_ticket(c);
  if (select coalesce(sum(count),0) from private.product_usage_counts where event='chat_converted_to_ticket')<>initial_count+1 then raise exception 'Conversion count incorrect'; end if;
  c:=public.start_support_chat(org,'Usage link test','PRIVATE_CHAT_CONTENT');
  perform public.link_chat_to_ticket(c,t);
  if (select coalesce(sum(count),0) from private.product_usage_counts where event='chat_converted_to_ticket')<>initial_count+1 then raise exception 'Link misclassified as conversion'; end if;
  select coalesce(sum(count),0) into captured from private.product_usage_counts;
  insert into public.chat_messages(organization_id,conversation_id,author_id,kind,body) values(org,c,auth.uid(),'internal_note','PRIVATE_NOTE');
  if (select coalesce(sum(count),0) from private.product_usage_counts)<>captured then raise exception 'Internal note counted as message'; end if;
  update public.product_usage_preferences set enabled=false where user_id=auth.uid();
  update public.tickets set priority='high' where id=t;
  if (select coalesce(sum(count),0) from private.product_usage_counts)<>captured then raise exception 'Collection continued after opt-out'; end if;
  update public.product_usage_preferences set enabled=true where user_id=auth.uid();
  -- Deliberately overflow only the analytics counter; the ticket must still save.
  insert into private.product_usage_counts(day,event,role,surface,count) values((now() at time zone 'UTC')::date,'ticket_created','administrator','tickets',9223372036854775807)
  on conflict(day,event,role,surface) do update set count=9223372036854775807;
  insert into public.tickets(organization_id,requester_id,title,description) values(org,auth.uid(),'Analytics failure fixture','PRIVATE_CONTENT');
  if not exists(select 1 from public.tickets where title='Analytics failure fixture' and organization_id=org) then raise exception 'Analytics blocked ticket creation'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform * from public.product_usage_summary(30); raise exception 'Customer can read owner analytics'; exception when insufficient_privilege then null; end;
 begin perform * from private.product_usage_counts; raise exception 'Customer can read counters'; exception when insufficient_privilege then null; end;
 begin insert into public.product_usage_preferences(user_id,enabled) values(gen_random_uuid(),true); raise exception 'Preference spoofing allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
