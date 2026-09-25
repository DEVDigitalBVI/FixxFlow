import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Report } from './model';

export async function getReport(organizationId: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('operational_report', { target_organization_id: organizationId });
  if (error || !data) return null;
  return data as unknown as Report;
}
