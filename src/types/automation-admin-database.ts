import type { Json } from './database.generated';
export type AutomationAdminFunctions = { read_automation_admin: {
  Args: { org: string; kind: string; query?: string; state?: string; trigger_type?: string; resource?: string; target?: string | null; selected?: string[]; page_number?: number };
  Returns: Json;
} };
