-- Test-only token issuer. Never deploy or use in application code.
create or replace function pg_temp.set_test_session(claims text, local_setting boolean) returns text
language plpgsql security definer set search_path='' as $$
declare payload jsonb:=claims::jsonb; actor uuid; session uuid;
begin
 if payload->>'sub' is not null and not(payload ? 'session_id') then
  actor:=(payload->>'sub')::uuid;
  if exists(select 1 from auth.users where id=actor) then
   select id into session from auth.sessions where user_id=actor and (not_after is null or not_after>now()) limit 1;
   if session is null then
    session:=gen_random_uuid();
    insert into auth.sessions(id,user_id,created_at) values(session,actor,now());
   end if;
   payload:=payload||jsonb_build_object('session_id',session);
  end if;
 end if;
 return set_config('request.jwt.claims',payload::text,local_setting);
end $$;

begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000021', 'chat-employee@example.test'),
  ('10000000-0000-0000-0000-000000000022', 'chat-technician@example.test'),
  ('10000000-0000-0000-0000-000000000023', 'other-employee@example.test');
insert into public.organizations (id, name, slug) values
  ('20000000-0000-0000-0000-000000000021', 'Chat Test', 'chat-test');
insert into public.organization_memberships (organization_id, user_id, role, status) values
  ('20000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000021', 'end_user', 'active'),
  ('20000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000022', 'technician', 'active'),
  ('20000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000023', 'end_user', 'active');

set local role authenticated;
select pg_temp.set_test_session( '{"sub":"10000000-0000-0000-0000-000000000021","role":"authenticated"}', true);
select extensions.lives_ok($$select public.start_support_chat('20000000-0000-0000-0000-000000000021', 'VPN connection', 'I see error 809')$$, 'employee can start a chat atomically');
select extensions.is((select count(*)::integer from public.chat_messages), 1, 'first message is part of chat history');
select extensions.throws_ok($$insert into public.chat_messages (organization_id, conversation_id, author_id, kind, body) select organization_id, id, requester_id, 'internal_note', 'hidden' from public.chat_conversations limit 1$$, '42501', null, 'employee cannot send internal notes');

select pg_temp.set_test_session( '{"sub":"10000000-0000-0000-0000-000000000023","role":"authenticated"}', true);
select extensions.is((select count(*)::integer from public.chat_conversations), 0, 'another employee cannot read the chat');

select pg_temp.set_test_session( '{"sub":"10000000-0000-0000-0000-000000000022","role":"authenticated"}', true);
select extensions.is((select count(*)::integer from public.chat_conversations), 1, 'technician sees incoming chat');
insert into public.chat_messages (organization_id, conversation_id, author_id, kind, body)
select organization_id, id, '10000000-0000-0000-0000-000000000022', 'internal_note', 'IT only'
from public.chat_conversations limit 1;
select extensions.lives_ok($$select public.convert_chat_to_ticket((select id from public.chat_conversations limit 1))$$, 'technician converts chat in one action');
select extensions.is((select count(*)::integer from public.chat_conversations c join public.tickets t on t.id = c.ticket_id and t.requester_id = c.requester_id join public.chat_messages m on m.conversation_id = c.id where m.body = 'I see error 809'), 1, 'ticket retains the complete linked chat history');
select extensions.lives_ok($$select public.convert_chat_to_ticket((select id from public.chat_conversations limit 1))$$, 'conversion is safe to repeat');
select pg_temp.set_test_session( '{"sub":"10000000-0000-0000-0000-000000000021","role":"authenticated"}', true);
select extensions.is((select count(*)::integer from public.chat_messages), 1, 'employee cannot read internal technician messages');

reset role;
select * from extensions.finish();
rollback;
