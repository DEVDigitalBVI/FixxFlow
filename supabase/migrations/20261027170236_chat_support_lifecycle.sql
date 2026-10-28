-- Public summaries contain only the topic and the last public IT reply.
alter table public.chat_conversations
  add column idle_warning_at timestamptz,
  add column idle_warning_anchor timestamptz,
  add column idle_warning_due_at timestamptz,
  add column idle_closed_at timestamptz,
  add column closure_summary text check (length(closure_summary) <= 1200);
-- Keep existing column grants, including server-owned chronology protections.
revoke insert(idle_warning_at,idle_warning_anchor,idle_warning_due_at,idle_closed_at,closure_summary),
  update(idle_warning_at,idle_warning_anchor,idle_warning_due_at,idle_closed_at,closure_summary)
  on public.chat_conversations from authenticated;

-- Rotate bounded scans so old unanswered chats cannot starve other work.
create table private.chat_idle_scans (
  conversation_id uuid primary key references public.chat_conversations(id) on delete cascade,
  checked_at timestamptz not null
);
revoke all on private.chat_idle_scans from public,anon,authenticated;

-- Serialize public sends/uploads/edits with closure. A participant who wins the
-- lock keeps the chat open; a later sender receives the existing closed-chat error.
create function private.lock_open_chat_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.chat_conversations%rowtype;
begin
  if auth.uid() is not null and not private.can_view_chat(new.organization_id,new.conversation_id) then
    return new; -- The caller's ordinary RLS policy rejects unauthorized activity.
  end if;
  select * into c from public.chat_conversations
    where id=new.conversation_id and organization_id=new.organization_id for update;
  if not found or c.status <> 'open' then
    raise exception 'Chat row-level security: this chat is closed. Start a new chat for further help.' using errcode='42501';
  end if;
  if tg_table_name='chat_attachments' or to_jsonb(new)->>'kind'='message' then
    update public.chat_conversations set idle_warning_at=null,idle_warning_anchor=null,idle_warning_due_at=null
      where id=c.id and organization_id=c.organization_id;
  end if;
  if tg_table_name='chat_attachments' or to_jsonb(new)->>'kind'='message' then
    update private.notification_email_outbox q set status='skipped',last_error='Chat activity resumed'
      from public.notifications n where n.id=q.notification_id and n.conversation_id=c.id
        and n.organization_id=c.organization_id and n.kind='chat_idle_warning' and q.status='pending';
  end if;
  return new;
end $$;
revoke all on function private.lock_open_chat_activity() from public,anon,authenticated;
create trigger chat_message_activity_lock before insert or update of body on public.chat_messages
  for each row execute function private.lock_open_chat_activity();
create trigger chat_attachment_activity_lock before insert on public.chat_attachments
  for each row execute function private.lock_open_chat_activity();

create function public.process_idle_chats(batch_size integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c record; last_activity record; zone text; elapsed double precision;
  warned integer:=0; closed integer:=0; checked integer:=0; at_time timestamptz:=clock_timestamp();
begin
  if batch_size is null or batch_size not between 1 and 100 then
    raise exception 'Invalid batch size' using errcode='22023';
  end if;
  for c in
    select cc.* from public.chat_conversations cc
    left join private.chat_idle_scans scan on scan.conversation_id=cc.id
    join public.organization_memberships member on member.organization_id=cc.organization_id
      and member.user_id=cc.requester_id and member.status='active'
    where cc.status='open' and cc.updated_at < at_time-interval '4 hours'
    order by coalesce(scan.checked_at,'epoch'::timestamptz),cc.updated_at,cc.id limit batch_size for update of cc skip locked
  loop
    checked:=checked+1;
    insert into private.chat_idle_scans(conversation_id,checked_at) values(c.id,at_time)
      on conflict(conversation_id) do update set checked_at=excluded.checked_at;
    select o.timezone into zone from public.organizations o where o.id=c.organization_id;
    -- Attachments are public activity too. Internal notes never start/reset this clock.
    select activity.* into last_activity from (
      select greatest(m.created_at,coalesce(m.edited_at,m.created_at)) at,
        m.author_id author, m.body, m.id
      from public.chat_messages m where m.organization_id=c.organization_id
        and m.conversation_id=c.id and m.kind='message'
      union all
      select a.created_at,a.uploaded_by,'File shared by IT'::text,a.id
      from public.chat_attachments a where a.organization_id=c.organization_id and a.conversation_id=c.id
    ) activity order by activity.at desc,activity.id desc limit 1;
    if not found or last_activity.author=c.requester_id or not exists (
      select 1 from public.organization_memberships m where m.organization_id=c.organization_id
        and m.user_id=last_activity.author and m.role in ('administrator','technician')
    ) then continue; end if;
    elapsed:=private.sla_business_seconds(last_activity.at,at_time,zone);
    if elapsed < 20*3600 then continue; end if;
    if c.idle_warning_at is null or c.idle_warning_anchor is distinct from last_activity.at then
      update public.chat_conversations set idle_warning_at=at_time,idle_warning_anchor=last_activity.at,
        idle_warning_due_at=private.sla_add_business_seconds(at_time,4*3600,zone)
        where id=c.id;
      perform private.enqueue_notification(c.organization_id,c.requester_id,null,null,c.id,'chat_idle_warning',
        'Your chat needs a reply: '||c.topic,false,'chat-idle-warning:'||c.id::text||':'||extract(epoch from last_activity.at)::text);
      warned:=warned+1;
    elsif elapsed >= 24*3600 and at_time >= c.idle_warning_due_at and private.sla_business_seconds(c.idle_warning_at,at_time,zone) >= 4*3600 then
      update public.chat_conversations set status='closed',idle_closed_at=at_time,
        closure_summary='Topic: '||c.topic||E'\n\nLast IT update: '||left(last_activity.body,700)||
          E'\n\nClosed automatically after 24 support hours without a reply. Start a new chat if you still need help.'
        where id=c.id;
      perform private.enqueue_notification(c.organization_id,c.requester_id,null,null,c.id,'chat_auto_closed',
        'Chat closed after inactivity: '||c.topic,false,'chat-idle-closed:'||c.id::text||':'||extract(epoch from last_activity.at)::text);
      update private.notification_email_outbox q set status='skipped',last_error='Chat closed'
        from public.notifications n where n.id=q.notification_id and n.conversation_id=c.id
          and n.organization_id=c.organization_id and n.kind='chat_idle_warning' and q.status='pending';
      closed:=closed+1;
    end if;
  end loop;
  return jsonb_build_object('checked',checked,'warned',warned,'closed',closed);
end $$;
revoke all on function public.process_idle_chats(integer) from public,anon,authenticated;
grant execute on function public.process_idle_chats(integer) to service_role;
