export type NotificationPreferences = {
  email_mode: 'immediate' | 'daily' | 'off';
  timezone: string;
  digest_hour: number;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  urgent_immediate: boolean;
};
export type NotificationPreferenceRow = NotificationPreferences & {
  organization_id: string;
  user_id: string;
  revision: number;
};
export type NotificationDigest = {
  digest_id: string;
  lease_token: string;
  recipient_email: string;
  workspace_name: string;
  items: unknown;
  total: number;
  local_day: string;
};
export function defaultNotificationPreferences(timezone: string): NotificationPreferences {
  return {
    email_mode: 'immediate',
    timezone,
    digest_hour: 8,
    quiet_enabled: false,
    quiet_start: '22:00',
    quiet_end: '07:00',
    urgent_immediate: true,
  };
}
export function parseNotificationPreferences(data: FormData): NotificationPreferences | null {
  const mode = String(data.get('email_mode') ?? '');
  const timezone = String(data.get('timezone') ?? '');
  const rawHour = String(data.get('digest_hour') ?? '');
  const hour = /^\d{1,2}$/.test(rawHour) ? Number(rawHour) : NaN;
  const start = String(data.get('quiet_start') ?? '');
  const end = String(data.get('quiet_end') ?? '');
  const quiet = data.get('quiet_enabled') === 'on';
  if (
    !['immediate', 'daily', 'off'].includes(mode) ||
    !timezone ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
    (quiet && start === end)
  )
    return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    return null;
  }
  return {
    email_mode: mode as NotificationPreferences['email_mode'],
    timezone,
    digest_hour: hour,
    quiet_start: start,
    quiet_end: end,
    quiet_enabled: quiet,
    urgent_immediate: data.get('urgent_immediate') === 'on',
  };
}
