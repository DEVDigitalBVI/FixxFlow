begin;

create table private.inbound_email_threads (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 message_id text not null check(char_length(message_id) between 3 and 512),
 sender_id uuid not null,
 ticket_id uuid not null,
 primary key(organization_id,message_id),
 foreign key(organization_id,sender_id) references public.organization_memberships(organization_id,user_id),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade
);
alter table private.inbound_email_threads enable row level security;
revoke all on private.inbound_email_threads from public,anon,authenticated,service_role;

alter table public.inbound_emails
 add column message_id text,
 add column attachment_status text not null default 'none' check(attachment_status in ('none','pending','processing','complete','failed')),
 add column imported_attachments integer not null default 0,
 add column skipped_attachments integer not null default 0;

create table private.inbound_attachment_jobs (
 id uuid primary key default gen_random_uuid(),
 inbound_id uuid not null unique references public.inbound_emails(id) on delete cascade,
 organization_id uuid not null,
 ticket_id uuid not null,
 sender_id uuid not null,
 internal boolean not null,
 attachment_ids text[] not null check(cardinality(attachment_ids)<=20),
 inline_ids text[] not null default '{}',
 processed_ids text[] not null default '{}',
 total_bytes integer not null default 0,
 status text not null default 'pending' check(status in ('pending','processing','complete','failed')),
 attempts integer not null default 0,
 lease_token uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(organization_id,sender_id) references public.organization_memberships(organization_id,user_id)
);
alter table private.inbound_attachment_jobs enable row level security;
revoke all on private.inbound_attachment_jobs from public,anon,authenticated,service_role;
create index inbound_attachment_work on private.inbound_attachment_jobs(next_attempt_at,lease_until) where status in ('pending','processing');

-- Staff mail is an internal note. Its imported files must obey the same audience.
alter table public.ticket_attachments add column is_internal boolean not null default false;
revoke insert(is_internal),update(is_internal) on public.ticket_attachments from anon,authenticated;
drop policy "Members can view permitted attachments" on public.ticket_attachments;
create policy "Members can view permitted attachments" on public.ticket_attachments for select to authenticated
 using(private.can_view_ticket(organization_id,ticket_id) and (not is_internal or private.can_work_tickets(organization_id)));
drop policy "Members can read permitted ticket files" on storage.objects;
create policy "Members can read permitted ticket files" on storage.objects for select to authenticated using(
 bucket_id='ticket-attachments' and private.can_view_ticket_path((storage.foldername(name))[1],(storage.foldername(name))[2])
 and (split_part(name,'/',4) not like 'inbound-%' or exists(select 1 from public.ticket_attachments a where a.storage_path=name))
);
drop policy "Members can upload permitted ticket files" on storage.objects;
create policy "Members can upload permitted ticket files" on storage.objects for insert to authenticated with check(
 bucket_id='ticket-attachments' and (storage.foldername(name))[3]=auth.uid()::text
 and split_part(name,'/',4) not like 'inbound-%'
 and private.can_view_ticket_path((storage.foldername(name))[1],(storage.foldername(name))[2])
);

drop function public.accept_inbound_email(text,text,text,text,text,boolean,integer);
create function private.accept_inbound_email(
  provider_id text, org_slug text, sender_email text, subject text, body text,
  authenticated boolean, attachment_count integer default 0, message_id text default null, reply_message_ids text[] default '{}', attachment_ids text[] default '{}', inline_attachment_ids text[] default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  org uuid; member record; target public.tickets%rowtype; prior public.inbound_emails%rowtype;
  sender text := lower(trim(sender_email)); raw_subject text := left(coalesce(subject,''),998);
  matched_ids uuid[]; thread_ticket uuid; inbound_id uuid; thread_sender uuid; referenced bigint; title text; content text; outcome text; ticket uuid; is_staff boolean;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if provider_id is null or char_length(provider_id) not between 1 and 200 then raise exception 'Invalid provider id'; end if;
  if cardinality(reply_message_ids)>50 or cardinality(attachment_ids)>20 or cardinality(inline_attachment_ids)>20 or not coalesce(inline_attachment_ids,'{}')<@coalesce(attachment_ids,'{}') or attachment_count not between 0 and 500
    or exists(select 1 from unnest(attachment_ids) id where id is null or char_length(id) not between 1 and 200)
    or (message_id is not null and (char_length(message_id)>512 or message_id !~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$'))
    or exists(select 1 from unnest(reply_message_ids) id where id is null or char_length(id)>512 or id !~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$') then
    raise exception 'Invalid email metadata' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inbound-provider:'||provider_id,0));
  -- Idempotent: Resend may deliver a webhook more than once.
  select * into prior from public.inbound_emails where provider_email_id=provider_id;
  if found then return jsonb_build_object('status',prior.status,'ticket_id',prior.ticket_id,'duplicate',true); end if;
  select id into org from public.organizations where slug=lower(trim(org_slug));
  if org is null then return jsonb_build_object('status','rejected_recipient'); end if;

  perform pg_advisory_xact_lock(hashtextextended('inbound-org:'||org::text,0));
  content := nullif(left(trim(coalesce(body,'')),19000),'');
  content := coalesce(content,'(No message text)');
  if attachment_count>0 then
    content := content||E'\n\n[Email files are processed separately. Allowed attachments will appear in this ticket after processing; inline signature images and unsupported files are skipped.]';
  end if;

  if not coalesce(authenticated,false) then outcome:='rejected_unauthenticated';
  else
    select m.user_id, m.role into member from public.organization_memberships m
      join auth.users u on u.id=m.user_id
      where m.organization_id=org and m.status='active' and m.deleted_at is null and lower(u.email)=sender and u.email_confirmed_at is not null
      limit 1;
    if member.user_id is null then outcome:='rejected_sender'; end if;
  end if;

  if outcome is null then
    is_staff := member.role in ('technician','administrator');
    if message_id is not null then
      select t.ticket_id,t.sender_id into thread_ticket,thread_sender from private.inbound_email_threads t
        where t.organization_id=org and t.message_id=accept_inbound_email.message_id;
      if found then
        if thread_sender<>member.user_id then return jsonb_build_object('status','rejected_ticket'); end if;
        return jsonb_build_object('status','duplicate_message','ticket_id',thread_ticket,'duplicate',true);
      end if;
    end if;
    select array_agg(distinct t.ticket_id) into matched_ids from private.inbound_email_threads t
      where t.organization_id=org and t.message_id=any(reply_message_ids);
    if cardinality(matched_ids)>1 then outcome:='rejected_ticket'; end if;
    thread_ticket:=matched_ids[1];
    referenced := nullif(substring(raw_subject from '\[#([0-9]{1,12})\]'),'')::bigint;
    if thread_ticket is not null then
      select * into target from public.tickets where organization_id=org and id=thread_ticket;
    elsif referenced is not null then
      select * into target from public.tickets where organization_id=org and ticket_number=referenced;
    end if;
    if outcome is not null then null;
    elsif target.id is not null and not (target.requester_id=member.user_id or is_staff) then
      outcome:='rejected_ticket';   -- never reveal or touch someone else's ticket
    elsif target.id is not null and (target.status<>'closed' or thread_ticket is not null) then
      -- The requester replies publicly; staff email replies become internal notes so an
      -- email reply never exposes text to the requester by accident.
      insert into private.inbound_message_contexts(organization_id,ticket_id,author_id)
        values(org,target.id,member.user_id);
      insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body)
        values(org,target.id,member.user_id,
          case when target.requester_id=member.user_id then 'reply'::public.ticket_message_kind else 'internal_note'::public.ticket_message_kind end,
          content);
      delete from private.inbound_message_contexts where transaction_id=pg_current_xact_id() and ticket_id=target.id;
      outcome:=case when target.requester_id=member.user_id then 'reply_added' else 'note_added' end;
      ticket:=target.id;
    else
      title := trim(regexp_replace(regexp_replace(raw_subject,'\[#[0-9]{1,12}\]','','g'),'^\s*((re|fw|fwd)\s*:\s*)+','','i'));
      if target.id is not null then title:='Follow-up to #'||target.ticket_number||': '||coalesce(nullif(title,''),'Email request'); end if;
      title := left(coalesce(nullif(title,''),'Email request'),180);
      if char_length(title)<3 then title:='Email request'; end if;
      insert into public.tickets(organization_id,requester_id,title,description)
        values(org,member.user_id,title,content) returning id into ticket;
      outcome:='ticket_created';
    end if;
  end if;

  insert into public.inbound_emails(organization_id,provider_email_id,sender,subject,status,ticket_id)
    values(org,provider_id,left(sender,320),raw_subject,outcome,ticket) returning id into inbound_id;
  if ticket is not null then
    update public.inbound_emails set message_id=accept_inbound_email.message_id where id=inbound_id;
    if message_id is not null then
      insert into private.inbound_email_threads(organization_id,message_id,sender_id,ticket_id)
        values(org,message_id,member.user_id,ticket);
    end if;
    if attachment_count>0 then
      insert into private.inbound_attachment_jobs(inbound_id,organization_id,ticket_id,sender_id,internal,attachment_ids,inline_ids)
        values(inbound_id,org,ticket,member.user_id,outcome='note_added',coalesce(attachment_ids,'{}'),coalesce(inline_attachment_ids,'{}'));
      update public.inbound_emails set attachment_status='pending',skipped_attachments=greatest(0,attachment_count-coalesce(cardinality(attachment_ids),0)) where id=inbound_id;
    end if;
  end if;
  return jsonb_build_object('status',outcome,'ticket_id',ticket,'duplicate',false);
end $$;

revoke all on function private.accept_inbound_email(text,text,text,text,text,boolean,integer,text,text[],text[],text[]) from public,anon,authenticated,service_role;
grant execute on function private.accept_inbound_email(text,text,text,text,text,boolean,integer,text,text[],text[],text[]) to service_role;
create function public.accept_inbound_email(provider_id text,org_slug text,sender_email text,subject text,body text,authenticated boolean,attachment_count integer default 0,message_id text default null,reply_message_ids text[] default '{}',attachment_ids text[] default '{}', inline_attachment_ids text[] default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select private.accept_inbound_email(provider_id,org_slug,sender_email,subject,body,authenticated,attachment_count,message_id,reply_message_ids,attachment_ids,inline_attachment_ids);
$$;
revoke all on function public.accept_inbound_email(text,text,text,text,text,boolean,integer,text,text[],text[],text[]) from public,anon,authenticated;
grant execute on function public.accept_inbound_email(text,text,text,text,text,boolean,integer,text,text[],text[],text[]) to service_role;

create function private.claim_inbound_attachments(batch_size integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
 update private.inbound_attachment_jobs j set status='failed' where j.status in ('pending','processing') and
 (j.attempts>=10 and coalesce(j.lease_until,now())<=now() or not exists(select 1 from public.organization_memberships m
   where m.organization_id=j.organization_id and m.user_id=j.sender_id and m.status='active' and m.deleted_at is null));
 update public.inbound_emails e set attachment_status='failed' from private.inbound_attachment_jobs j where j.inbound_id=e.id and j.status='failed' and e.attachment_status<>'failed';
 with candidates as(select id from private.inbound_attachment_jobs where status in ('pending','processing') and attempts<10
   and next_attempt_at<=now() and coalesce(lease_until,'-infinity')<=now() order by next_attempt_at,id for update skip locked limit greatest(1,least(batch_size,2))),
 claimed as(update private.inbound_attachment_jobs j set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
   from candidates c where j.id=c.id returning j.*)
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('provider_email_id',e.provider_email_id)),'[]'::jsonb) into result
 from claimed c join public.inbound_emails e on e.id=c.inbound_id;
 update public.inbound_emails e set attachment_status='processing' from private.inbound_attachment_jobs j where j.inbound_id=e.id and j.status='processing';
 return result;
end $$;
revoke all on function private.claim_inbound_attachments(integer) from public,anon,authenticated;
grant execute on function private.claim_inbound_attachments(integer) to service_role;
create function public.claim_inbound_attachments(batch_size integer default 1) returns jsonb language sql security invoker set search_path='' as $$select private.claim_inbound_attachments(batch_size);$$;
revoke all on function public.claim_inbound_attachments(integer) from public,anon,authenticated;
grant execute on function public.claim_inbound_attachments(integer) to service_role;

create function private.record_inbound_attachment(job_id uuid,token uuid,provider_attachment_id text,imported boolean,file_name text default '',content_type text default '',size_bytes integer default 0) returns boolean
language plpgsql security definer set search_path='' as $$
declare job private.inbound_attachment_jobs; file_id uuid; path text;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
 select * into job from private.inbound_attachment_jobs where id=job_id for update;
 if job.id is null or job.status<>'processing' or job.lease_token is distinct from token or job.lease_until<now() then return false; end if;
 if not(provider_attachment_id=any(job.attachment_ids)) then raise exception 'Unknown email attachment'; end if;
 if provider_attachment_id=any(job.processed_ids) then return true; end if;
 if not exists(select 1 from public.organization_memberships m where m.organization_id=job.organization_id and m.user_id=job.sender_id and m.status='active' and m.deleted_at is null)
 then return false; end if;
 if imported then
  if content_type not in ('image/png','image/jpeg','image/webp','application/pdf','text/plain') or size_bytes not between 1 and 10485760
   or job.total_bytes+size_bytes>20971520 or char_length(file_name) not between 1 and 120 then raise exception 'Invalid email attachment'; end if;
  file_id:=md5(job.id::text||':'||provider_attachment_id)::uuid;
  path:=job.organization_id::text||'/'||job.ticket_id::text||'/'||job.sender_id::text||'/inbound-'||file_id::text;
  insert into public.ticket_attachments(id,organization_id,ticket_id,uploaded_by,storage_path,file_name,content_type,size_bytes,is_internal)
   values(file_id,job.organization_id,job.ticket_id,job.sender_id,path,file_name,content_type,size_bytes,job.internal) on conflict(id) do nothing;
 end if;
 update private.inbound_attachment_jobs set processed_ids=array_append(processed_ids,provider_attachment_id),total_bytes=total_bytes+case when imported then size_bytes else 0 end where id=job.id;
 update public.inbound_emails set imported_attachments=imported_attachments+case when imported then 1 else 0 end,
   skipped_attachments=skipped_attachments+case when imported then 0 else 1 end where id=job.inbound_id;
 return true;
end $$;
revoke all on function private.record_inbound_attachment(uuid,uuid,text,boolean,text,text,integer) from public,anon,authenticated;
grant execute on function private.record_inbound_attachment(uuid,uuid,text,boolean,text,text,integer) to service_role;
create function public.record_inbound_attachment(job_id uuid,token uuid,provider_attachment_id text,imported boolean,file_name text default '',content_type text default '',size_bytes integer default 0) returns boolean language sql security invoker set search_path='' as $$
 select private.record_inbound_attachment(job_id,token,provider_attachment_id,imported,file_name,content_type,size_bytes);
$$;
revoke all on function public.record_inbound_attachment(uuid,uuid,text,boolean,text,text,integer) from public,anon,authenticated;
grant execute on function public.record_inbound_attachment(uuid,uuid,text,boolean,text,text,integer) to service_role;

create function private.finish_inbound_attachments(job_id uuid,token uuid,success boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare job private.inbound_attachment_jobs; next_status text;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
 select * into job from private.inbound_attachment_jobs where id=job_id for update;
 if job.id is null or job.status<>'processing' or job.lease_token is distinct from token or job.lease_until<now() then return false; end if;
 next_status:=case when success and cardinality(job.processed_ids)=cardinality(job.attachment_ids) then 'complete' when job.attempts>=10 then 'failed' else 'pending' end;
 update private.inbound_attachment_jobs set status=next_status,lease_until=null,lease_token=null,next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(job.attempts,7)))::integer) where id=job.id;
 update public.inbound_emails set attachment_status=next_status where id=job.inbound_id;
 return true;
end $$;
revoke all on function private.finish_inbound_attachments(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function private.finish_inbound_attachments(uuid,uuid,boolean) to service_role;
create function public.finish_inbound_attachments(job_id uuid,token uuid,success boolean) returns boolean language sql security invoker set search_path='' as $$select private.finish_inbound_attachments(job_id,token,success);$$;
revoke all on function public.finish_inbound_attachments(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.finish_inbound_attachments(uuid,uuid,boolean) to service_role;

notify pgrst,'reload schema';
commit;
