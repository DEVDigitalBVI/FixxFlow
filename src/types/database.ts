import type { InventoryTables, InventoryFunctions } from './inventory-database';
import type { Database as GeneratedDatabase } from './database.generated';
import type { AutomationFunctions, AutomationTables } from './automation-database';
import type { DomainEventFunctions } from './domain-event-database';
import type { AutomationExecutionFunctions, AutomationExecutionTables } from './automation-execution-database';
import type { AutomationAdminFunctions } from './automation-admin-database';
import type { AutomationDryRunFunctions } from './automation-dry-run-database';
import type { AutomationWorkerFunctions } from './automation-worker-database';
export type { Json } from './database.generated';

type Schema = GeneratedDatabase['public'];
type Tables = Schema['Tables'];
type Functions = Schema['Functions'];
export type AppRole = Schema['Enums']['app_role'];
export type MembershipStatus = Schema['Enums']['membership_status'];
export type TicketStatus = Schema['Enums']['ticket_status'];
export type TicketPriority = Schema['Enums']['ticket_priority'];
export type TicketMessageKind = Schema['Enums']['ticket_message_kind'];
export type ChatStatus = Schema['Enums']['chat_status'];
export type ChatMessageKind = Schema['Enums']['chat_message_kind'];
export type NotificationKind = Schema['Enums']['notification_kind'] | 'automation_update';
export type Notification = Omit<Tables['notifications']['Row'], 'kind'> & { kind: NotificationKind };
export type KnowledgeArticle = Tables['knowledge_articles']['Row'];
export type KnowledgeAsset = Tables['knowledge_attachments']['Row'];

// PostgreSQL CHECK constraints and nullable function arguments are not inferred
// by the generator. Keep these small refinements separate from generated schema.
export type AssetKind = 'computer' | 'phone' | 'printer' | 'network' | 'software' | 'other';
export type AssetStatus = 'available' | 'in_use' | 'repair' | 'retired';
type AssetFields = { kind: AssetKind; status: AssetStatus };
export type Asset = Omit<Tables['assets']['Row'], keyof AssetFields> & AssetFields;
export type NotificationEmail = Omit<Functions['claim_notification_emails']['Returns'][number], 'ticket_id' | 'conversation_id'> & {
  ticket_id: string | null;
  conversation_id: string | null;
};
type NullableArgs<Name extends keyof Functions, Keys extends keyof Functions[Name]['Args']> =
  Omit<Functions[Name], 'Args'> & {
    Args: Omit<Functions[Name]['Args'], Keys> & {
      [Key in Keys]?: Functions[Name]['Args'][Key] | null;
    };
  };

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<Schema, 'Tables' | 'Functions' | 'Enums'> & {
    Enums: Omit<Schema['Enums'], 'notification_kind'> & { notification_kind: NotificationKind };
    Tables: Omit<Tables, 'assets' | 'tickets' | 'ticket_messages' | 'notifications'> & AutomationTables & AutomationExecutionTables & InventoryTables & {
      notifications: Omit<Tables['notifications'], 'Row'> & { Row: Notification };
      ticket_messages: Omit<Tables['ticket_messages'], 'Row'> & {
        Row: Omit<Tables['ticket_messages']['Row'], 'author_id'> & {
          author_id: string | null; author_type: 'member' | 'automation';
          automation_execution_id: string | null; automation_step_id: string | null; automation_name: string | null;
        };
      };
      // BEFORE INSERT triggers assign the number and SLA deadlines.
      tickets: Omit<Tables['tickets'], 'Row' | 'Insert'> & {
        Row: Tables['tickets']['Row'] & { request_kind: 'support' | 'inventory'; revision: number; unassigned_since: string | null; unassigned_episode_id: string | null; waiting_on_user_since: string | null; waiting_on_user_episode_id: string | null };
        Insert: Omit<Tables['tickets']['Insert'], 'ticket_number' | 'response_sla_due_at' | 'resolution_sla_due_at'>;
      };
      assets: Omit<Tables['assets'], 'Row' | 'Insert' | 'Update'> & {
        Row: Asset;
        Insert: Omit<Tables['assets']['Insert'], keyof AssetFields> & { kind: AssetKind; status?: AssetStatus };
        Update: Omit<Tables['assets']['Update'], keyof AssetFields> & Partial<AssetFields>;
      };
    };
    Functions: Omit<Functions, 'create_equipment_ticket' | 'record_product_usage' | 'manage_customer' | 'finish_notification_email' | 'claim_notification_emails' | 'search_tickets'> & AutomationFunctions & DomainEventFunctions & AutomationExecutionFunctions & AutomationWorkerFunctions & AutomationDryRunFunctions & AutomationAdminFunctions & InventoryFunctions & {
      search_tickets: Omit<Functions['search_tickets'], 'Returns'> & { Returns: (Functions['search_tickets']['Returns'][number] & { request_kind: 'support' | 'inventory' })[] };
      lookup_choices: { Args: { org: string; resource: string; query?: string; after_label?: string | null; after_id?: string | null; selected?: string | null; parent?: string | null; active_only?: boolean }; Returns: import('@/features/lookups/model').LookupChoice[] };
      start_automation_run: { Args: { kind: string }; Returns: string };
      finish_automation_run: { Args: { run_id: string; outcome: string; metrics: import('./database.generated').Json }; Returns: boolean };
      read_automation_operations: { Args: { org: string }; Returns: import('./database.generated').Json };
      read_automation_operations_history: { Args: { org: string; query?: string; trigger_type?: string; result_filter?: string; since_at?: string | null; until_at?: string | null; before_at?: string | null; before_id?: string | null; ticket_number?: number | null }; Returns: import('./database.generated').Json };
      discover_temporal_automation: { Args: { rule_limit?: number; ticket_limit?: number }; Returns: import('./database.generated').Json };
      create_equipment_ticket: NullableArgs<'create_equipment_ticket', 'category'>;
      record_product_usage: NullableArgs<'record_product_usage', 'org' | 'target_id' | 'event_token'>;
      manage_customer: Omit<Functions['manage_customer'], 'Args'> & {
        Args: { target: string | null; customer_name: string; customer_slug?: string | null; admin_email?: string | null; admin_name?: string | null };
      };
      finish_notification_email: NullableArgs<'finish_notification_email', 'provider_message_id' | 'failure'>;
      claim_notification_emails: Omit<Functions['claim_notification_emails'], 'Returns'> & { Returns: NotificationEmail[] };
    };
  };
};
