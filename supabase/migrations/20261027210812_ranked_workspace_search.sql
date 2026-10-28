-- Pure text helpers never read records or bypass RLS.
create function private.workspace_search_text(value text) returns text
language sql immutable parallel safe set search_path='' as $$
 select regexp_replace(lower(coalesce(value,'')),'wi[ -]?fi','wifi','g');
$$;
create function private.search_typo_distance(a text,b text,budget integer) returns integer
language plpgsql immutable parallel safe set search_path='' as $$
declare n integer:=length(a); m integer:=length(b); d integer[][]; i integer; j integer; cost integer;
begin
 if n=0 then return m; end if;
 if m=0 then return n; end if;
 if n>32 or m>34 or abs(n-m)>budget then return budget+1; end if;
 d:=array_fill(0,array[n+1,m+1],array[0,0]);
 for i in 0..n loop d[i][0]:=i; end loop;
 for j in 0..m loop d[0][j]:=j; end loop;
 for i in 1..n loop
  for j in 1..m loop
   cost:=case when substr(a,i,1)=substr(b,j,1) then 0 else 1 end;
   d[i][j]:=least(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+cost);
   if i>1 and j>1 and substr(a,i,1)=substr(b,j-1,1) and substr(a,i-1,1)=substr(b,j,1) then
    d[i][j]:=least(d[i][j],d[i-2][j-2]+1);
   end if;
  end loop;
 end loop;
 return d[n][m];
end $$;
create function private.workspace_text_score(heading text,body text,query text) returns double precision
language plpgsql immutable parallel safe set search_path='' as $$
declare h text:=private.workspace_search_text(heading); b text:=private.workspace_search_text(left(body,2000));
 q text:=private.workspace_search_text(trim(left(query,200))); term text; distance integer; budget integer;
 score double precision:=0; all_heading boolean:=true; approximate boolean:=false;
begin
 if q='' then return 0; end if;
 if h=q then return 1000; end if;
 if strpos(h,q)=1 then return 900; end if;
 if strpos(h,q)>0 then return 800; end if;
 for term in select distinct word from regexp_split_to_table(q,'[[:space:]]+') word where word<>'' loop
  if strpos(h,term)>0 then score:=score+40;
  elsif strpos(b,term)>0 then score:=score+10; all_heading:=false;
  else
   if term !~ '^[[:alpha:]]{4,32}$' then return 0; end if;
   budget:=case when length(term)>=8 then 2 else 1 end;
   select min(private.search_typo_distance(term,word,budget)) into distance from (
    select distinct word from regexp_split_to_table(h||' '||b,'[^[:alnum:]]+') word
    where abs(length(word)-length(term))<=budget and length(word)>0
      and extensions.similarity(term,word)>=0.1
   ) candidates;
   if distance is null or distance>budget then return 0; end if;
   score:=score+2-distance; approximate:=true; all_heading:=false;
  end if;
 end loop;
 return case when approximate then 200+score/100 when all_heading then 700+score/100 else 500+score/100 end;
end $$;
revoke all on function private.workspace_search_text(text),private.search_typo_distance(text,text,integer),private.workspace_text_score(text,text,text) from public,anon;
grant execute on function private.workspace_search_text(text),private.search_typo_distance(text,text,integer),private.workspace_text_score(text,text,text) to authenticated;

-- Candidate operators use pg_trgm indexes; final bounded edit distance rejects
-- loose trigram matches. No shared dictionary contains other users' private text.
create index tickets_workspace_fuzzy on public.tickets using gin((title||' '||description) extensions.gin_trgm_ops);
create index library_workspace_fuzzy on public.library_articles using gin((title||' '||summary) extensions.gin_trgm_ops);
create index knowledge_workspace_fuzzy on public.knowledge_articles using gin((title||' '||summary) extensions.gin_trgm_ops);
-- profiles_partial_search_idx already indexes the matching profile expression.
create function public.search_workspace(org uuid,search_text text)
returns table(id uuid,kind text,label text,detail text,audience text,shared boolean,approximate boolean,score double precision)
language sql stable security invoker set search_path='' set pg_trgm.word_similarity_threshold='0.1' as $$
 with input as materialized (
  select trim(left(coalesce(search_text,''),200)) q,
   case when trim(search_text) ~ '^#[0-9]{1,15}$' then substring(trim(search_text) from 2)::bigint end exact_number,
   private.is_active_organization_member(org) and private.has_required_assurance() allowed
 ), terms as materialized (
  select word from input i cross join lateral regexp_split_to_table(i.q,'[[:space:]]+') word
  where i.allowed and i.q<>'' and i.exact_number is null
 ), literal_tickets as materialized (
  select t.* from input i cross join lateral public.search_tickets(org,i.q) t where i.allowed and i.q<>''
 ), literal_people as materialized (
  select p.* from input i cross join lateral public.search_members(org,i.q) m
   join public.profiles p on p.organization_id=m.organization_id and p.user_id=m.user_id
  where i.allowed and i.q<>'' and i.exact_number is null and private.can_work_tickets(org)
 ), literal_articles as materialized (
  select a.* from input i cross join lateral public.search_knowledge_articles(org,i.q) a
  where i.allowed and i.q<>'' and i.exact_number is null and a.status='published'
 ), candidates as (
  select t.id,'ticket'::text kind,t.title label,'#'||t.ticket_number detail,null::text audience,false shared,
    greatest(300,private.workspace_text_score(t.title,t.description,i.q),
      case when t.ticket_number=i.exact_number then 10000 when t.ticket_number::text=i.q then 9500 else 0 end)::double precision score
  from literal_tickets t cross join input i
  union all
  select t.id,'ticket',t.title,'#'||t.ticket_number,null::text,false,
    private.workspace_text_score(t.title,t.description,i.q)
  from public.tickets t cross join input i
  where i.allowed and i.exact_number is null and t.organization_id=org
    and exists(select 1 from terms w where (t.title||' '||t.description) operator(extensions.%>) w.word)
  union all
  select p.user_id,'person',coalesce(nullif(p.display_name,''),p.email,'Member'),coalesce(p.email,''),null::text,false,
    greatest(300,private.workspace_text_score(p.display_name,coalesce(p.email,'')||' '||coalesce(p.job_title,''),i.q))
  from literal_people p cross join input i
  union all
  select p.user_id,'person',coalesce(nullif(p.display_name,''),p.email,'Member'),coalesce(p.email,''),null::text,false,
    private.workspace_text_score(p.display_name,coalesce(p.email,'')||' '||coalesce(p.job_title,''),i.q)
  from public.profiles p cross join input i
  where i.allowed and i.exact_number is null and p.organization_id=org and private.can_work_tickets(org)
    and exists(select 1 from public.organization_memberships m where m.organization_id=org and m.user_id=p.user_id)
    and exists(select 1 from terms w where (p.display_name||' '||coalesce(p.email,'')||' '||coalesce(p.job_title,'')) operator(extensions.%>) w.word)
  union all
  select a.id,'article',a.title,''::text,a.audience,a.organization_id is null,
    greatest(300,private.workspace_text_score(a.title,a.summary,i.q))
  from literal_articles a cross join input i
  union all
  select a.id,'article',a.title,''::text,a.audience,a.organization_id is null,
    private.workspace_text_score(a.title,a.summary,i.q)
  from public.readable_knowledge_articles a cross join input i
  where i.allowed and i.exact_number is null and (a.organization_id=org or a.organization_id is null) and a.status='published'
    and exists(select 1 from terms w where (a.title||' '||a.summary) operator(extensions.%>) w.word)
 ), ranked as (
  select distinct on(c.kind,c.id) c.* from candidates c where c.score>0 order by c.kind,c.id,c.score desc
 )
 select r.id,r.kind,r.label,r.detail,r.audience,r.shared,r.score<300,r.score
 from ranked r order by r.score desc,lower(r.label),r.kind,r.id limit 20;
$$;
revoke all on function public.search_workspace(uuid,text) from public,anon;
grant execute on function public.search_workspace(uuid,text) to authenticated;
