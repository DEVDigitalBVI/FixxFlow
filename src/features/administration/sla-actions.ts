'use server';

import { revalidatePath } from 'next/cache';

import { validSchedule, validTargets, type SlaTargets } from '@/features/tickets/organization-sla';
import { fixedSlaTargets } from '@/features/tickets/sla-policy';
import type { ActionResult } from '@/lib/action-result';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export async function saveSlaPolicy(form: FormData): Promise<ActionResult & { version?: number }> {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator')
    return { error: 'Only administrators can change SLA settings.' };
  const integer = (name: string) =>
    /^\d+$/.test(String(form.get(name) ?? '')) ? Number(form.get(name)) : NaN;
  const time = (name: string) => {
    const value = String(form.get(name) ?? '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  };
  const targets = Object.fromEntries(
    fixedSlaTargets.map(({ priority }) => [
      priority,
      { response: integer(`${priority}-response`), resolution: integer(`${priority}-resolution`) },
    ]),
  ) as SlaTargets;
  const schedule = {
    days: form.getAll('days').map(Number),
    opens: time('opens'),
    closes: time('closes') || (form.get('closes') === '00:00' ? 1440 : NaN),
  };
  if (!validTargets(targets))
    return {
      error:
        'Enter whole minutes from 1 to 525,600 for every target. Resolution must be at least as long as first response.',
    };
  if (!validSchedule(schedule))
    return {
      error:
        'Select at least one working day and an opening time before closing time. Use 00:00 as closing time for midnight.',
    };
  const version = integer('version');
  if (!Number.isSafeInteger(version)) return { error: 'Reload SLA settings before saving.' };
  const client = await createClient();
  const { data, error } = await client.rpc('save_organization_sla_policy', {
    org: viewer.organizationId,
    expected_version: version,
    targets,
    schedule,
  });
  if (error)
    return {
      error:
        error.code === '40001'
          ? 'SLA settings changed in another session. Reload this page before saving again.'
          : 'SLA settings could not be saved. Your entries are preserved. Please try again.',
    };
  revalidatePath('/app/administration/slas');
  revalidatePath('/app/administration/priorities');
  revalidatePath('/app/tickets/new');
  return {
    version: data,
    success:
      'SLA standards saved. New tickets will use these targets and working hours. Existing tickets keep their original SLA policy.',
  };
}
