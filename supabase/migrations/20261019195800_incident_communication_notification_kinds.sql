-- Enum additions commit before the communication functions use them.
alter type public.notification_kind add value if not exists 'incident_update';
alter type public.notification_kind add value if not exists 'incident_update_due';
