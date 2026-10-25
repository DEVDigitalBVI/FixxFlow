alter type public.notification_kind add value if not exists 'incident_escalation';
alter type public.notification_kind add value if not exists 'incident_approval';
alter type public.notification_kind add value if not exists 'incident_step_assigned';
