create index ticket_attachments_uploader_idx
  on public.ticket_attachments (organization_id, uploaded_by);
create index ticket_messages_author_idx
  on public.ticket_messages (organization_id, author_id);
create index tickets_category_subcategory_idx
  on public.tickets (organization_id, category_id, subcategory_id);
create index tickets_location_idx
  on public.tickets (organization_id, location_id);
create index tickets_team_idx
  on public.tickets (organization_id, team_id);
