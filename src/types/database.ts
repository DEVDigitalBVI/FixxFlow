import type { Database as GeneratedDatabase } from './database.generated';
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
export type NotificationKind = Schema['Enums']['notification_kind'];
export type Notification = Tables['notifications']['Row'];
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
  public: Omit<Schema, 'Tables' | 'Functions'> & {
    Tables: Omit<Tables, 'assets' | 'tickets'> & {
      // BEFORE INSERT triggers assign the number and SLA deadlines.
      tickets: Omit<Tables['tickets'], 'Insert'> & {
        Insert: Omit<Tables['tickets']['Insert'], 'ticket_number' | 'response_sla_due_at' | 'resolution_sla_due_at'>;
      };
      assets: Omit<Tables['assets'], 'Row' | 'Insert' | 'Update'> & {
        Row: Asset;
        Insert: Omit<Tables['assets']['Insert'], keyof AssetFields> & { kind: AssetKind; status?: AssetStatus };
        Update: Omit<Tables['assets']['Update'], keyof AssetFields> & Partial<AssetFields>;
      };
    };
    Functions: Omit<Functions, 'create_equipment_ticket' | 'record_product_usage' | 'manage_customer' | 'finish_notification_email' | 'claim_notification_emails'> & {
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
