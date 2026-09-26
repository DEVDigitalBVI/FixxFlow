-- Staff may request a manual team choice at creation; the trigger forces employee routing.
-- Keep timestamps and other server-owned columns restricted.
grant insert (routing_mode) on public.tickets to authenticated;
