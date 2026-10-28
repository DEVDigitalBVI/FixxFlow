'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import {
  defaultReportDefinition,
  definitionAsJson,
  definitionFromInput,
} from '@/features/reporting/custom-model';
import type { ActionResult } from '@/lib/action-result';
import { requireViewer } from '@/lib/auth/viewer';
import { isUuid } from '@/lib/ids';
import { reportServerError, type FailureOperation } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

const uuid = (value: FormDataEntryValue | null) =>
  typeof value === 'string' && isUuid(value) ? value : null;
const text = (value: FormDataEntryValue | null, limit: number) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';
function reportInput(data: FormData) {
  const end = text(data.get('endDate'), 10) || new Date().toISOString().slice(0, 10);
  return definitionFromInput(data, defaultReportDefinition(end));
}
function mutationError(action: FailureOperation, error: unknown): ActionResult {
  const reference = reportServerError(action, error);
  return {
    error: `The report could not be saved. Your choices are preserved. Reference: ${reference}`,
  };
}
export async function saveReport(data: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user')
    return { error: 'Custom reports are available to support staff only.' };
  const definition = reportInput(data),
    name = text(data.get('name'), 120),
    description = text(data.get('description'), 500) || null;
  const reportId = uuid(data.get('reportId'));
  const requestedVisibility = data.get('visibility') === 'shared' ? 'shared' : 'personal';
  const visibility = viewer.role === 'administrator' ? requestedVisibility : 'personal';
  if (!definition)
    return {
      error: 'Review the date range, measures and grouping. The period can be up to 366 days.',
    };
  if (name.length < 2)
    return {
      error: 'Give this report a name with at least 2 characters.',
      fieldErrors: { name: 'Enter a report name.' },
    };
  const database = await createClient();
  try {
    if (reportId) {
      const { data: existing, error: readError } = await database
        .from('saved_reports')
        .select('id,owner_id,visibility')
        .eq('organization_id', viewer.organizationId)
        .eq('id', reportId)
        .maybeSingle();
      if (readError) throw readError;
      if (!existing || (existing.owner_id !== viewer.id && viewer.role !== 'administrator'))
        return { error: 'You do not have permission to update this report.' };
      const { data: updated, error } = await database
        .from('saved_reports')
        .update({ name, description, visibility, definition: definitionAsJson(definition) })
        .eq('organization_id', viewer.organizationId)
        .eq('id', reportId)
        .select('id')
        .maybeSingle();
      if (error || !updated) throw error ?? new Error('Report update returned no row');
      revalidatePath('/app/reports');
      return { redirectTo: `/app/reports/saved/${updated.id}` };
    }
    const { data: created, error } = await database
      .from('saved_reports')
      .insert({
        organization_id: viewer.organizationId,
        owner_id: viewer.id,
        name,
        description,
        visibility,
        definition: definitionAsJson(definition),
      })
      .select('id')
      .single();
    if (error) throw error;
    revalidatePath('/app/reports');
    return { redirectTo: `/app/reports/saved/${created.id}` };
  } catch (error) {
    return mutationError('report.save', error);
  }
}
export async function deleteReport(data: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  const reportId = uuid(data.get('reportId'));
  if (viewer.role === 'end_user' || !reportId || data.get('confirmation') !== reportId)
    return { error: 'Confirm the report you want to delete.' };
  const database = await createClient();
  try {
    const { error, count } = await database
      .from('saved_reports')
      .delete({ count: 'exact' })
      .eq('organization_id', viewer.organizationId)
      .eq('id', reportId);
    if (error || count !== 1) throw error ?? new Error('Report deletion was not authorized');
    revalidatePath('/app/reports');
    return { redirectTo: '/app/reports' };
  } catch (error) {
    return mutationError('report.delete', error);
  }
}
function recipients(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return null;
  const items = [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  return items.length >= 1 &&
    items.length <= 20 &&
    items.every((item) => item.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
    ? items
    : null;
}
export async function saveReportSchedule(data: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  const reportId = uuid(data.get('reportId'));
  if (viewer.role !== 'administrator' || !reportId)
    return { error: 'Only administrators can schedule report delivery.' };
  const frequency = data.get('frequency');
  if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly')
    return { error: 'Choose daily, weekly or monthly delivery.' };
  const weekday = Number(data.get('weekday') || NaN),
    monthday = Number(data.get('monthday') || NaN),
    runHour = Number(data.get('runHour') || NaN);
  const format = ['xlsx', 'csv', 'pdf'].includes(String(data.get('format')))
    ? (data.get('format') as 'xlsx' | 'csv' | 'pdf')
    : 'xlsx';
  const emails = recipients(data.get('recipients'));
  if (
    !emails ||
    !Number.isInteger(runHour) ||
    runHour < 0 ||
    runHour > 23 ||
    (frequency === 'weekly'
      ? !Number.isInteger(weekday) || weekday < 0 || weekday > 6
      : frequency === 'monthly' && (!Number.isInteger(monthday) || monthday < 1 || monthday > 31))
  )
    return { error: 'Review the delivery day, hour and recipient email addresses.' };
  const database = await createClient();
  try {
    const { error } = await database.from('report_schedules').insert({
      organization_id: viewer.organizationId,
      report_id: reportId,
      created_by: viewer.id,
      frequency,
      weekday: frequency === 'weekly' ? weekday : null,
      monthday: frequency === 'monthly' ? monthday : null,
      run_hour: runHour,
      timezone: viewer.organizationTimezone,
      format,
      recipient_emails: emails,
    });
    if (error) throw error;
    revalidatePath(`/app/reports/saved/${reportId}`);
    return { success: 'Scheduled delivery created.' };
  } catch (error) {
    return mutationError('report.schedule.save', error);
  }
}
export async function manageReportSchedule(data: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  const scheduleId = uuid(data.get('scheduleId')),
    reportId = uuid(data.get('reportId'));
  if (viewer.role !== 'administrator' || !scheduleId || !reportId)
    return { error: 'Only administrators can change report delivery.' };
  const command = data.get('command');
  const database = await createClient();
  try {
    const query =
      command === 'delete'
        ? database.from('report_schedules').delete({ count: 'exact' })
        : database
            .from('report_schedules')
            .update({ active: command === 'activate' }, { count: 'exact' });
    const { error, count } = await query
      .eq('organization_id', viewer.organizationId)
      .eq('report_id', reportId)
      .eq('id', scheduleId);
    if (error || count !== 1) throw error ?? new Error('Schedule change returned no row');
    revalidatePath(`/app/reports/saved/${reportId}`);
    return {
      success:
        command === 'delete'
          ? 'Scheduled delivery deleted.'
          : command === 'activate'
            ? 'Scheduled delivery activated.'
            : 'Scheduled delivery paused.',
    };
  } catch (error) {
    return mutationError('report.schedule.manage', error);
  }
}
