-- Demand-loaded staff suggestions; existing (organization_id,tag) index scopes aggregation.
create function public.ticket_tag_suggestions(org uuid)
returns table(tag text) language plpgsql stable security invoker set search_path='' as $$
begin
 if private.can_work_tickets(org) is not true then raise exception 'Ticket staff access required' using errcode='42501'; end if;
 return query select t.tag from public.ticket_tags t where t.organization_id=org
 group by t.tag order by count(*) desc,t.tag collate "C" asc limit 50;
end $$;
revoke all on function public.ticket_tag_suggestions(uuid) from public,anon,service_role;
grant execute on function public.ticket_tag_suggestions(uuid) to authenticated;
