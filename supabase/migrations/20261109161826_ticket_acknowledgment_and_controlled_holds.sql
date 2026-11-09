-- Enum values must commit before the workflow uses them.
alter type public.notification_kind add value if not exists 'hold_review_due';
