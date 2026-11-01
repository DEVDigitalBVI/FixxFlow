begin;

-- Keep both row types aligned for the existing invoker view and search RPC.
alter table public.knowledge_articles
 add column help_collection text not null default 'knowledge' check(help_collection='knowledge'),
 add column help_topic text,
 add column help_format text not null default 'guide' check(help_format='guide'),
 add constraint knowledge_has_no_product_topic check(help_topic is null);
alter table public.library_articles
 add column help_collection text not null default 'knowledge' check(help_collection in ('knowledge','fixxflow')),
 add column help_topic text,
 add column help_format text not null default 'guide' check(help_format in ('guide','faq')),
 add constraint library_help_topic check(
   (help_collection='knowledge' and help_topic is null and help_format='guide') or
   (help_collection='fixxflow' and help_topic is not null and help_topic in ('getting-started','requests','equipment','account','administration','automations')));
grant insert(help_collection,help_topic,help_format),update(help_collection,help_topic,help_format) on public.library_articles to authenticated;
create index library_help_collection_browse on public.library_articles(help_collection,audience,help_topic,help_format,status,updated_at desc,id);

-- Migration-owned content changes do not impersonate a signed-in platform editor.
alter table public.library_articles disable trigger library_article_audit;

-- Reclassify the existing product guides in place. Links, feedback, related IDs,
-- workspace hide preferences, audience and content remain attached to the same IDs.
update public.library_articles set help_collection='fixxflow', help_topic=case
 when title ilike '%get started%' or title ilike '%find administration tools%' or title ilike '%triage tickets%' or title='Get help and submit a useful IT request' then 'getting-started'
 when title ilike '%automation%' then 'automations'
 when title ilike '%equipment%' or title ilike '%inventory%' or title ilike '%stock%' then 'equipment'
 when title ilike '%profile%' or title ilike '%password%' or title ilike '%authenticator%' or title ilike '%notification%' or title ilike '%recover from failed%' or title ilike '%search the workspace%' then 'account'
 when audience='it_only' and (title ilike '%members%' or title ilike '%departments%' or title ilike '%teams%' or title ilike '%article%' or title ilike '%guide%' or title ilike '%reports%' or title ilike '%owner console%' or title ilike '%analytics%' or title ilike '%workspace records%' or title ilike '%permissions%') then 'administration'
 else 'requests' end
where title like 'FixxFlow:%' or title in ('Get help and submit a useful IT request','Follow a ticket, reply to IT, or reopen an issue','Reset your FixxFlow password','Set up an authenticator for FixxFlow');

create or replace view public.readable_knowledge_articles with (security_invoker=true) as
 select * from public.knowledge_articles union all select * from public.library_articles;

insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:employee-contact')::uuid,'Should I submit a request or start a chat?','Use a request for issues that need tracking, equipment requests, and follow-up work. Use chat for a quick conversation with IT when chat is available. For an urgent outage, also follow your organization’s established contact procedure.','Software','[{"type": "paragraph", "text": "Use a request for issues that need tracking, equipment requests, and follow-up work. Use chat for a quick conversation with IT when chat is available. For an urgent outage, also follow your organization’s established contact procedure."}]'::jsonb,'published','employees','fixxflow','getting-started','faq',array(select id from public.library_articles where title='Get help and submit a useful IT request' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:employee-progress')::uuid,'Where can I see updates on my request?','Open My requests and choose the request. Its status, conversation, and expected reply and resolution times appear there. Reply in the same request so IT has the full history.','Software','[{"type": "paragraph", "text": "Open My requests and choose the request. Its status, conversation, and expected reply and resolution times appear there. Reply in the same request so IT has the full history."}]'::jsonb,'published','employees','fixxflow','requests','faq',array(select id from public.library_articles where title='Follow a ticket, reply to IT, or reopen an issue' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:employee-waiting')::uuid,'What does Waiting on user mean?','IT needs information from you. Open the request and reply with the requested details. Waiting pauses the resolution target; your reply resumes the work. The first-response target is separate.','Software','[{"type": "paragraph", "text": "IT needs information from you. Open the request and reply with the requested details. Waiting pauses the resolution target; your reply resumes the work. The first-response target is separate."}]'::jsonb,'published','employees','fixxflow','requests','faq',array(select id from public.library_articles where title='Follow a ticket, reply to IT, or reopen an issue' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:employee-reopen')::uuid,'Can I reopen a resolved request?','For the same unresolved issue, open the request and use Reopen ticket, explaining what still happens. For a different problem, submit a new request. Reopening keeps the existing conversation and history.','Software','[{"type": "paragraph", "text": "For the same unresolved issue, open the request and use Reopen ticket, explaining what still happens. For a different problem, submit a new request. Reopening keeps the existing conversation and history."}]'::jsonb,'published','employees','fixxflow','requests','faq',array(select id from public.library_articles where title='Follow a ticket, reply to IT, or reopen an issue' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:employee-equipment')::uuid,'How do I request equipment or supplies?','Use the inventory request flow when your organization has granted you permission. Pick the department and items, then submit for approval. If that option is unavailable, submit an IT request explaining what you need.','Software','[{"type": "paragraph", "text": "Use the inventory request flow when your organization has granted you permission. Pick the department and items, then submit for approval. If that option is unavailable, submit an IT request explaining what you need."}]'::jsonb,'published','employees','fixxflow','equipment','faq',array(select id from public.library_articles where title='FixxFlow: request department equipment or supplies' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:employee-access')::uuid,'What should I do if I cannot sign in?','Use Forgot password on your usual FixxFlow sign-in page. If you cannot access your work email or authenticator, or your workspace access is inactive, contact your IT team through another established channel. Never share your password or verification codes.','Software','[{"type": "paragraph", "text": "Use Forgot password on your usual FixxFlow sign-in page. If you cannot access your work email or authenticator, or your workspace access is inactive, contact your IT team through another established channel. Never share your password or verification codes."}]'::jsonb,'published','employees','fixxflow','account','faq',array(select id from public.library_articles where title='Reset your FixxFlow password' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:it-teams')::uuid,'How are teams different from departments and ticket owners?','A team groups the IT function handling a ticket, such as IT Support or Networking. A department describes the requester’s business unit. The assigned technician is the individual ticket owner. Categories can route new tickets to a default team.','Software','[{"type": "paragraph", "text": "A team groups the IT function handling a ticket, such as IT Support or Networking. A department describes the requester’s business unit. The assigned technician is the individual ticket owner. Categories can route new tickets to a default team."}]'::jsonb,'published','it_only','fixxflow','getting-started','faq',array(select id from public.library_articles where title='FixxFlow: manage teams, categories, subcategories, and default routing' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:it-notes')::uuid,'When should I use a public reply or an internal note?','Use a public reply for information the requester should receive. Use an internal note for staff-only troubleshooting and coordination. Check the selected audience before sending; internal notes do not count as a public first response.','Software','[{"type": "paragraph", "text": "Use a public reply for information the requester should receive. Use an internal note for staff-only troubleshooting and coordination. Check the selected audience before sending; internal notes do not count as a public first response."}]'::jsonb,'published','it_only','fixxflow','requests','faq',array(select id from public.library_articles where title='FixxFlow: send public replies and keep internal notes separate' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:it-status')::uuid,'Which status should I choose while handling a ticket?','Use In progress while working, Waiting on user when you need the requester’s reply, and On hold for an IT-side dependency. Mark Resolved when a solution is recorded, then close according to your process. Waiting on user pauses resolution; On hold continues counting scheduled support time.','Software','[{"type": "paragraph", "text": "Use In progress while working, Waiting on user when you need the requester’s reply, and On hold for an IT-side dependency. Mark Resolved when a solution is recorded, then close according to your process. Waiting on user pauses resolution; On hold continues counting scheduled support time."}]'::jsonb,'published','it_only','fixxflow','requests','faq',array(select id from public.library_articles where title='FixxFlow: assign, classify, resolve, or reopen a ticket' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:it-sla')::uuid,'Can our organization set its own SLA standards?','Administrators can open Settings → SLAs to set response and resolution targets, working days, and daily support hours in the workspace timezone. New tickets use the saved policy. Existing tickets retain their original targets and schedule, including after priority changes or waiting/resume.','Software','[{"type": "paragraph", "text": "Administrators can open Settings → SLAs to set response and resolution targets, working days, and daily support hours in the workspace timezone. New tickets use the saved policy. Existing tickets retain their original targets and schedule, including after priority changes or waiting/resume."}]'::jsonb,'published','it_only','fixxflow','administration','faq',array(select id from public.library_articles where title='FixxFlow: understand priority, service targets, and overdue indicators' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:it-delete')::uuid,'What happens when someone is deleted from the workspace?','Deletion removes workspace access and the People directory entry while preserving the login identity and linked ticket, chat, and equipment history. Administrators can delete other members; technicians can delete employees only. Reassign outstanding work and equipment where needed. Deactivation remains a separate reversible action.','Software','[{"type": "paragraph", "text": "Deletion removes workspace access and the People directory entry while preserving the login identity and linked ticket, chat, and equipment history. Administrators can delete other members; technicians can delete employees only. Reassign outstanding work and equipment where needed. Deactivation remains a separate reversible action."}]'::jsonb,'published','it_only','fixxflow','administration','faq',array(select id from public.library_articles where title='FixxFlow: invite members and manage roles or workspace access' limit 1));
insert into public.library_articles(id,title,summary,category,content,status,audience,help_collection,help_topic,help_format,related_article_ids)
 values(md5('fixxflow-faq:it-automation')::uuid,'How can I check an automation before enabling it?','Use the automation test or dry-run flow to inspect matching tickets and planned actions without applying those ticket changes. Review the result, rule order, and conditions before enabling the automation. Monitor execution history for failures afterward.','Software','[{"type": "paragraph", "text": "Use the automation test or dry-run flow to inspect matching tickets and planned actions without applying those ticket changes. Review the result, rule order, and conditions before enabling the automation. Monitor execution history for failures afterward."}]'::jsonb,'published','it_only','fixxflow','automations','faq',array(select id from public.library_articles where title='FixxFlow: test an automation without changing tickets' limit 1));

alter table public.library_articles enable trigger library_article_audit;

-- Product FAQs have their own search. Request suggestions stay focused on troubleshooting.
create or replace function public.suggest_knowledge_articles(org uuid,query text,category_name text default '')
returns table(id uuid,organization_id uuid,title text,summary text,category text,audience text)
language sql stable security invoker set search_path='' as $$
 with input as (select replace(plainto_tsquery('english',regexp_replace(lower(left(coalesce(query,''),200)),'wi[ -]?fi','wifi','g'))::text,' & ',' | ')::tsquery terms),
 ranked as (
 select a.id,a.organization_id,a.title,a.summary,a.category,a.audience,
 ts_rank_cd(private.article_suggestion_vector(a.title,a.summary),i.terms)
 + case when a.category=category_name and category_name<>'' then 0.3 else 0 end score
 from public.readable_knowledge_articles a cross join input i
 where private.is_active_organization_member(org) and (a.organization_id=org or a.organization_id is null) and a.status='published' and a.help_collection='knowledge'
 and (private.article_suggestion_vector(a.title,a.summary) @@ i.terms or (a.category=category_name and category_name<>''))
 ) select r.id,r.organization_id,r.title,r.summary,r.category,r.audience from ranked r where r.score>0 order by r.score desc,r.title,r.id limit 3;
$$;
revoke all on function public.suggest_knowledge_articles(uuid,text,text) from public,anon;
grant execute on function public.suggest_knowledge_articles(uuid,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
