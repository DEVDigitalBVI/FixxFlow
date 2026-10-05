begin;

-- Stop publishing sample guides for new customer organizations.
drop trigger if exists organization_knowledge_seed on public.organizations;
drop function if exists private.seed_organization_knowledge();
drop function if exists private.seed_knowledge_articles(uuid);

-- Match the original seed exactly. Preserve authored or edited guides and uploads.
delete from public.knowledge_articles a
using (values ('Accounts','Reset your password','Use the Forgot password link on the sign-in page. Open the email we send you and choose a new password. If you cannot access your email, contact IT.'),('Network','Connect to Wi-Fi','Choose your organization’s Wi-Fi network, enter your work credentials, and reconnect. If the network is missing or your credentials are rejected, send IT a request with your location and device type.'),('Security','Set up multi-factor authentication','Open Account security, choose Set up authenticator, and scan the code with your authenticator app. Keep your recovery method in a safe place.'),('Security','Report a lost device','Contact IT as soon as possible. Tell us what device is missing, when you last had it, and how we can reach you. If your account may be exposed, reset your password.')) as seed(category,title,body)
where a.author_id is null
  and a.revision = 1
  and a.status = 'published'
  and a.summary = ''
  and cardinality(a.related_article_ids) = 0
  and a.category = seed.category
  and a.title = seed.title
  and a.content = jsonb_build_array(jsonb_build_object('type','paragraph','text',seed.body))
  and not exists (select 1 from public.knowledge_attachments f where f.article_id = a.id)
  and not exists (select 1 from public.knowledge_articles other where a.id = any(other.related_article_ids));

commit;
