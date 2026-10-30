'use client';

import { useState } from 'react';

import { saveNotificationPreferences } from '@/app/app/notifications/settings/actions';
import { ActionForm } from '@/components/ui/action-form';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { TimezoneSelect } from '@/features/timezones/select';

import type { NotificationPreferences } from './preferences-model';
import styles from './preferences.module.css';

export function NotificationPreferencesForm({
  initial,
  revision: initialRevision,
}: {
  initial: NotificationPreferences;
  revision: number;
}) {
  const [settings, setSettings] = useState(initial);
  const [revision, setRevision] = useState(initialRevision);
  const daily = settings.email_mode === 'daily';
  const enabled = settings.email_mode !== 'off';
  const quiet = enabled && settings.quiet_enabled;
  const urgent = enabled && (daily || quiet);
  return (
    <ActionForm
      className={`stack ${styles.scope}`}
      action={async (data) => {
        const result = await saveNotificationPreferences(data);
        if (result.revision !== undefined) setRevision(result.revision);
        return result;
      }}
    >
      <input type="hidden" name="revision" value={revision} />
      <label className="field">
        Email updates
        <NativeSelect
          name="email_mode"
          value={settings.email_mode}
          onChange={(e) =>
            setSettings({
              ...settings,
              email_mode: e.target.value as NotificationPreferences['email_mode'],
            })
          }
        >
          <option value="immediate">As they happen</option>
          <option value="daily">Daily summary</option>
          <option value="off">Off</option>
        </NativeSelect>
      </label>
      <TimezoneSelect value={initial.timezone} label="Notification timezone" />
      <label className="field" hidden={!daily}>
        Daily summary time
        <NativeSelect
          name="digest_hour"
          disabled={!daily}
          value={settings.digest_hour}
          onChange={(e) => setSettings({ ...settings, digest_hour: Number(e.target.value) })}
        >
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={hour}>{`${String(hour).padStart(2, '0')}:00`}</option>
          ))}
        </NativeSelect>
      </label>
      {!daily && <input type="hidden" name="digest_hour" value={settings.digest_hour} />}
      {daily && (
        <p className="muted">
          Starts at the next scheduled time in your notification timezone. If quiet hours overlap,
          the summary waits until they end. Nothing is sent when there are no updates.
        </p>
      )}
      <fieldset className="stack" hidden={!enabled} disabled={!enabled}>
        <legend>Quiet hours</legend>
        <label className="checkbox-row">
          <Checkbox
            name="quiet_enabled"
            checked={settings.quiet_enabled}
            onChange={(e) => setSettings({ ...settings, quiet_enabled: e.target.checked })}
          />
          Pause email during quiet hours
        </label>
        <div className="form-grid" hidden={!quiet}>
          <label className="field">
            From
            <Input
              type="time"
              name="quiet_start"
              disabled={!quiet}
              value={settings.quiet_start.slice(0, 5)}
              onChange={(e) => setSettings({ ...settings, quiet_start: e.target.value })}
              required
            />
          </label>
          <label className="field">
            Until
            <Input
              type="time"
              name="quiet_end"
              disabled={!quiet}
              value={settings.quiet_end.slice(0, 5)}
              onChange={(e) => setSettings({ ...settings, quiet_end: e.target.value })}
              required
            />
          </label>
        </div>
      </fieldset>
      {!enabled && settings.quiet_enabled && (
        <input type="hidden" name="quiet_enabled" value="on" />
      )}
      {!quiet && (
        <>
          <input type="hidden" name="quiet_start" value={settings.quiet_start.slice(0, 5)} />
          <input type="hidden" name="quiet_end" value={settings.quiet_end.slice(0, 5)} />
        </>
      )}
      <label className="checkbox-row" hidden={!urgent}>
        <Checkbox
          name="urgent_immediate"
          disabled={!urgent}
          checked={settings.urgent_immediate}
          onChange={(e) => setSettings({ ...settings, urgent_immediate: e.target.checked })}
        />
        Send urgent alerts immediately
      </label>
      {!urgent && settings.urgent_immediate && (
        <input type="hidden" name="urgent_immediate" value="on" />
      )}
      {urgent && (
        <p className="muted">
          Urgent tickets, SLA warnings and workflow escalations can bypass the daily summary and
          quiet hours.
        </p>
      )}
      <p className="muted">
        In-app updates stay available. Workspace announcements and account/security emails are sent
        separately.
      </p>
      <SubmitButton variant="primary">Save preferences</SubmitButton>
    </ActionForm>
  );
}
