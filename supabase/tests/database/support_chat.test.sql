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
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000021","role":"authenticated"}', true);
select extensions.lives_ok($$select public.start_support_chat('20000000-0000-0000-0000-000000000021', 'VPN connection', 'I see error 809')$$, 'employee can start a chat atomically');
select extensions.is((select count(*)::integer from public.chat_messages), 1, 'first message is part of chat history');
select extensions.throws_ok($$insert into public.chat_messages (organization_id, conversation_id, author_id, kind, body) select organization_id, id, requester_id, 'internal_note', 'hidden' from public.chat_conversations limit 1$$, 'employee cannot send internal notes');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000023","role":"authenticated"}', true);
select extensions.is((select count(*)::integer from public.chat_conversations), 0, 'another employee cannot read the chat');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000022","role":"authenticated"}', true);
select extensions.is((select count(*)::integer from public.chat_conversations), 1, 'technician sees incoming chat');
insert into public.chat_messages (organization_id, conversation_id, author_id, kind, body)
select organization_id, id, '10000000-0000-0000-0000-000000000022', 'internal_note', 'IT only'
from public.chat_conversations limit 1;
select extensions.lives_ok($$select public.convert_chat_to_ticket((select id from public.chat_conversations limit 1))$$, 'technician converts chat in one action');
select extensions.is((select count(*)::integer from public.chat_conversations c join public.tickets t on t.id = c.ticket_id and t.requester_id = c.requester_id join public.chat_messages m on m.conversation_id = c.id where m.body = 'I see error 809'), 1, 'ticket retains the complete linked chat history');
select extensions.lives_ok($$select public.convert_chat_to_ticket((select id from public.chat_conversations limit 1))$$, 'conversion is safe to repeat');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000021","role":"authenticated"}', true);
select extensions.is((select count(*)::integer from public.chat_messages), 1, 'employee cannot read internal technician messages');

reset role;
select * from extensions.finish();
rollback;
