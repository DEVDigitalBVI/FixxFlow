import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isCustomReport, isCustomReportDefinition, type CustomReport, type CustomReportDefinition, type ReportDelivery, type ReportReferences, type ReportSchedule, type SavedReport } from './custom-model';

export async function getCustomReport(organizationId: string, definition: CustomReportDefinition, options: { throwOnError?: boolean } = {}): Promise<CustomReport | null> {
  const database = await createClient();
  const { data, error } = await database.rpc('custom_report', { target_organization_id: organizationId, report_config: definition });
  if (error && options.throwOnError) throw error;
  return error || !isCustomReport(data) ? null : data;
}
function saved(row: unknown): row is SavedReport {
  if (!row || typeof row !== 'object') return false;
  const item = row as SavedReport;
  return typeof item.id === 'string' && typeof item.name === 'string' && ['personal','shared'].includes(item.visibility) && isCustomReportDefinition(item.definition);
}
export async function getSavedReports(organizationId: string): Promise<SavedReport[]> {
  const database = await createClient();
  const { data, error } = await database.from('saved_reports').select('*').eq('organization_id', organizationId).order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).filter(saved);
}
export async function getSavedReport(organizationId: string, id: string): Promise<SavedReport | null> {
  const database = await createClient();
  const { data, error } = await database.from('saved_reports').select('*').eq('organization_id', organizationId).eq('id', id).maybeSingle();
  if (error) throw error;
  return saved(data) ? data : null;
}
export async function getReportReferences(organizationId: string): Promise<ReportReferences> {
  const database = await createClient();
  const [categories, subcategories, teams, memberships, profiles, departments, locations] = await Promise.all([
    database.from('ticket_categories').select('id,name').eq('organization_id', organizationId).order('name'),
    database.from('ticket_subcategories').select('id,name,category_id').eq('organization_id', organizationId).order('name'),
    database.from('teams').select('id,name').eq('organization_id', organizationId).order('name'),
    database.from('organization_memberships').select('user_id,role,status').eq('organization_id', organizationId).eq('status', 'active'),
    database.from('profiles').select('user_id,display_name').eq('organization_id', organizationId).order('display_name'),
    database.from('departments').select('id,name').eq('organization_id', organizationId).order('name'),
    database.from('locations').select('id,name').eq('organization_id', organizationId).order('name'),
  ]);
  const failure = [categories,subcategories,teams,memberships,profiles,departments,locations].find(result => result.error)?.error;
  if (failure) throw failure;
  const staff = new Set((memberships.data ?? []).filter(item => item.role === 'administrator' || item.role === 'technician').map(item => item.user_id));
  return {
    categories: categories.data ?? [], subcategories: subcategories.data ?? [], teams: teams.data ?? [],
    technicians: (profiles.data ?? []).filter(item => staff.has(item.user_id)).map(item => ({ id: item.user_id, name: item.display_name })),
    departments: departments.data ?? [], locations: locations.data ?? [],
  };
}
export async function getReportSchedules(organizationId: string, reportId: string): Promise<ReportSchedule[]> {
  const database = await createClient();
  const { data, error } = await database.from('report_schedules').select('id,report_id,frequency,weekday,monthday,run_hour,timezone,format,recipient_emails,active,next_run_at,last_enqueued_at').eq('organization_id', organizationId).eq('report_id', reportId).order('created_at');
  if (error) throw error;
  return (data ?? []) as ReportSchedule[];
}
export async function getReportDeliveryHistory(reportId: string): Promise<ReportDelivery[]> {
  const database = await createClient();
  const { data, error } = await database.rpc('report_delivery_history', { target_report_id: reportId });
  if (error) throw error;
  return data ?? [];
}

