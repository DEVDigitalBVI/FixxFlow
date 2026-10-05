-- Commit the enum extension before the following migration uses its value.
alter type public.notification_kind add value 'automation_update';
