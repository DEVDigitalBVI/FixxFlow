import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Report } from './model';
import { isReport } from './payload';

export async function getReport(organizationId: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('operational_report', { target_organization_id: organizationId });
  if (error || !isReport(data)) return null;
  return data;
}
