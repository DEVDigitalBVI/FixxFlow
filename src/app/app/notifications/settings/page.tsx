import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { NotificationPreferencesForm } from '@/features/notifications/preferences-form';
import { defaultNotificationPreferences } from '@/features/notifications/preferences-model';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export default async function NotificationSettingsPage() {
  const viewer = await requireViewer();
  const db = await createClient();
  const { data, error } = await db
    .from('notification_preferences')
    .select('*')
    .eq('organization_id', viewer.organizationId)
    .eq('user_id', viewer.id)
    .maybeSingle();
  return (
    <div className="page page-narrow stack">
      <PageHeader
        title="Notification preferences"
        description="Choose when email updates reach you."
        back={{ href: '/app/notifications', label: 'Back to notifications' }}
      />
      <section className="settings-card">
        {error ? (
          <Alert tone="error" role="alert">
            Preferences couldn’t load. <Link href="/app/notifications/settings">Try again</Link>
          </Alert>
        ) : (
          <NotificationPreferencesForm
            initial={
              data ??
              defaultNotificationPreferences(
                viewer.timezonePreference ?? viewer.organizationTimezone,
              )
            }
            revision={data?.revision ?? 0}
          />
        )}
      </section>
    </div>
  );
}
