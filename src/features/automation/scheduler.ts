import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { AutomationWorkerError } from './worker-failures';
/** Discovery only. Actions remain exclusively in the established worker/RPCs. */
export async function discoverTemporalAutomation(client: SupabaseClient<Database>) {
  const { data, error } = await client.rpc('discover_temporal_automation', { rule_limit: 5, ticket_limit: 100 });
  if (error) throw new AutomationWorkerError(error.code);
  return data;
}
