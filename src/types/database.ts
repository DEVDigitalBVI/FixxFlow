import type { RoomMessage } from '@/features/chat/message-model';
import type { CustomReportDefinition, ReportDelivery } from '@/features/reporting/custom-model';

import type { AutomationAdminFunctions } from './automation-admin-database';
import type { AutomationFunctions, AutomationTables } from './automation-database';
import type { AutomationDryRunFunctions } from './automation-dry-run-database';
import type {
  AutomationExecutionFunctions,
  AutomationExecutionTables,
} from './automation-execution-database';
import type { AutomationWorkerFunctions } from './automation-worker-database';
import type { Database as GeneratedDatabase, Json } from './database.generated';
import type { DomainEventFunctions } from './domain-event-database';
import type { InventoryFunctions, InventoryTables } from './inventory-database';

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
export type NotificationKind =
  | Schema['Enums']['notification_kind']
  | 'ticket_created'
  | 'automation_update'
  | 'incident_update'
  | 'incident_update_due'
  | 'incident_escalation'
  | 'incident_approval'
  | 'incident_step_assigned'
  | 'chat_idle_warning'
  | 'chat_auto_closed'
  | 'asset_lifecycle'
  | 'inventory_low_stock';
export type Notification = Omit<Tables['notifications']['Row'], 'kind'> & {
  kind: NotificationKind;
  incident_bulletin_id: string | null;
  asset_id?: string | null;
  inventory_item_id?: string | null;
};
export type KnowledgeArticle = Tables['knowledge_articles']['Row'] & {
  audience: import('@/features/knowledge/audience').KnowledgeAudience;
};
export type LibraryArticle = Omit<KnowledgeArticle, 'organization_id'> & { organization_id: null };
export type ReadableArticle = KnowledgeArticle | LibraryArticle;
export type KnowledgeAsset = Tables['knowledge_attachments']['Row'];

// PostgreSQL CHECK constraints and nullable function arguments are not inferred
// by the generator. Keep these small refinements separate from generated schema.
export type AssetKind = 'computer' | 'phone' | 'printer' | 'network' | 'software' | 'other';
export type AssetStatus = 'available' | 'in_use' | 'repair' | 'retired';
type AssetFields = { kind: AssetKind; status: AssetStatus; end_of_life_on?: string | null };
export type Asset = Omit<Tables['assets']['Row'], keyof AssetFields> & AssetFields;
export type NotificationEmail = Omit<
  Functions['claim_notification_emails']['Returns'][number],
  'ticket_id' | 'conversation_id' | 'service_announcement_id'
> & {
  ticket_id: string | null;
  conversation_id: string | null;
  incident_bulletin_id?: string | null;
  service_announcement_id?: string | null;
  approved_body?: string | null;
  email_kind?: NotificationKind | null;
  reply_author?: string | null;
  reply_preview?: string | null;
  reply_created_at?: string | null;
  ticket_status?: TicketStatus | null;
  ticket_priority?: TicketPriority | null;
  previous_status?: TicketStatus | null;
  status_changed_by?: string | null;
  ticket_owner?: string | null;
  event_created_at?: string | null;
  reopen_reason?: string | null;
  next_update_at?: string | null;
};
type NullableArgs<Name extends keyof Functions, Keys extends keyof Functions[Name]['Args']> = Omit<
  Functions[Name],
  'Args'
> & {
  Args: Omit<Functions[Name]['Args'], Keys> & {
    [Key in Keys]?: Functions[Name]['Args'][Key] | null;
  };
};

type LibraryTable = {
  Row: LibraryArticle;
  Insert: Pick<KnowledgeArticle, 'id' | 'title' | 'category'> &
    Partial<
      Pick<KnowledgeArticle, 'summary' | 'content' | 'status' | 'audience' | 'related_article_ids'>
    >;
  Update: Partial<
    Pick<
      KnowledgeArticle,
      'title' | 'category' | 'summary' | 'content' | 'status' | 'audience' | 'related_article_ids'
    >
  >;
  Relationships: [];
};
type RuntimeTables = {
  ticket_resolution_ratings: {
    Row: {
      id: string;
      organization_id: string;
      ticket_id: string;
      requester_id: string | null;
      assigned_technician_id: string | null;
      resolved_at: string;
      score: number;
      comment: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: never;
    Update: never;
    Relationships: [];
  };
  workspace_security_policies: {
    Row: {
      organization_id: string;
      require_mfa: boolean;
      revision: number;
      updated_by: string;
      updated_at: string;
    };
    Insert: never;
    Update: never;
    Relationships: [];
  };
  notification_preferences: {
    Row: import('@/features/notifications/preferences-model').NotificationPreferenceRow;
    Insert: never;
    Update: never;
    Relationships: [];
  };
  library_article_views: {
    Row: { organization_id: string; article_id: string; user_id: string; viewed_on: string };
    Insert: { organization_id: string; article_id: string };
    Update: never;
    Relationships: [];
  };
  library_article_feedback: {
    Row: {
      organization_id: string;
      article_id: string;
      user_id: string;
      helpful: boolean;
      updated_at: string;
    };
    Insert: { organization_id: string; article_id: string; helpful: boolean };
    Update: { helpful: boolean };
    Relationships: [];
  };
  hidden_library_articles: {
    Row: {
      organization_id: string;
      article_id: string;
      created_by: string | null;
      created_at: string;
    };
    Insert: { organization_id: string; article_id: string };
    Update: never;
    Relationships: [];
  };
  chat_conversations: Omit<Tables['chat_conversations'], 'Row' | 'Insert' | 'Update'> & {
    Row: Tables['chat_conversations']['Row'] & {
      idle_warning_at: string | null;
      idle_warning_anchor: string | null;
      idle_warning_due_at: string | null;
      idle_closed_at: string | null;
      closure_summary: string | null;
    };
    Insert: Tables['chat_conversations']['Insert'];
    Update: Tables['chat_conversations']['Update'];
  };
  service_announcements: Omit<Tables['service_announcements'], 'Row'> & {
    Row: Tables['service_announcements']['Row'] &
      import('@/features/tickets/announcement-status').AnnouncementDetails;
  };
  service_announcement_drafts: Omit<Tables['service_announcement_drafts'], 'Row'> & {
    Row: Tables['service_announcement_drafts']['Row'] &
      import('@/features/tickets/announcement-status').AnnouncementDetails;
  };
} & AutomationTables &
  AutomationExecutionTables &
  InventoryTables & {
    ticket_workflows: {
      Row: import('@/features/workflows/model').TicketWorkflow;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    workflow_templates: {
      Row: import('@/features/workflows/model').WorkflowTemplate;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    workflow_template_drafts: {
      Row: import('@/features/workflows/model').TemplateDraft;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    workflow_template_versions: {
      Row: import('@/features/workflows/model').TemplateVersion;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    ticket_workflow_applications: {
      Row: import('@/features/workflows/model').WorkflowApplication;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_escalation_policies: {
      Row: import('@/features/tickets/incident-control').EscalationPolicy;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_approvals: {
      Row: import('@/features/tickets/incident-control').IncidentApproval;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_approval_history: {
      Row: import('@/features/tickets/incident-control').ApprovalHistory;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_escalations: {
      Row: import('@/features/tickets/incident-control').IncidentEscalation;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_control_history: {
      Row: import('@/features/tickets/incident-control').ControlChange;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_communication_plans: {
      Row: import('@/features/tickets/communications').CommunicationPlan;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_stakeholder_groups: {
      Row: import('@/features/tickets/communications').StakeholderGroup;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_stakeholder_members: {
      Row: import('@/features/tickets/communications').StakeholderMember;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_update_drafts: {
      Row: import('@/features/tickets/communications').UpdateDraft;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_bulletins: {
      Row: import('@/features/tickets/communications').IncidentBulletin;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_bulletin_recipients: {
      Row: import('@/features/tickets/communications').BulletinRecipient;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    incident_steps: {
      Row: import('@/features/tickets/response-checklist').IncidentStep;
      Insert: Partial<import('@/features/tickets/response-checklist').IncidentStep>;
      Update: Partial<import('@/features/tickets/response-checklist').IncidentStep>;
      Relationships: [];
    };
    incident_step_history: {
      Row: import('@/features/tickets/response-checklist').StepHistory;
      Insert: never;
      Update: never;
      Relationships: [];
    };
    ticket_incidents: {
      Row: import('@/features/tickets/incidents').Incident;
      Insert: import('@/features/tickets/incidents').IncidentInput & {
        ticket_id: string;
        organization_id: string;
      };
      Update: Partial<import('@/features/tickets/incidents').IncidentInput>;
      Relationships: [];
    };
    saved_reports: {
      Row: {
        id: string;
        organization_id: string;
        owner_id: string;
        name: string;
        description: string | null;
        visibility: 'personal' | 'shared';
        definition: CustomReportDefinition;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        owner_id: string;
        name: string;
        description?: string | null;
        visibility?: 'personal' | 'shared';
        definition: import('./database.generated').Json;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        name?: string;
        description?: string | null;
        visibility?: 'personal' | 'shared';
        definition?: import('./database.generated').Json;
        updated_at?: string;
      };
      Relationships: [];
    };
    report_schedules: {
      Row: {
        id: string;
        organization_id: string;
        report_id: string;
        created_by: string;
        frequency: 'daily' | 'weekly' | 'monthly';
        weekday: number | null;
        monthday: number | null;
        run_hour: number;
        timezone: string;
        format: 'xlsx' | 'csv' | 'pdf';
        recipient_emails: string[];
        active: boolean;
        next_run_at: string;
        last_enqueued_at: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        report_id: string;
        created_by: string;
        frequency: 'daily' | 'weekly' | 'monthly';
        weekday?: number | null;
        monthday?: number | null;
        run_hour: number;
        timezone: string;
        format?: 'xlsx' | 'csv' | 'pdf';
        recipient_emails: string[];
        active?: boolean;
        next_run_at?: string;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        frequency?: 'daily' | 'weekly' | 'monthly';
        weekday?: number | null;
        monthday?: number | null;
        run_hour?: number;
        timezone?: string;
        format?: 'xlsx' | 'csv' | 'pdf';
        recipient_emails?: string[];
        active?: boolean;
        next_run_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    organizations: Omit<Tables['organizations'], 'Row' | 'Insert' | 'Update'> & {
      Row: Tables['organizations']['Row'] & { timezone: string };
      Insert: Tables['organizations']['Insert'] & { timezone?: string };
      Update: Tables['organizations']['Update'] & { timezone?: string };
    };
    profiles: Omit<Tables['profiles'], 'Row' | 'Insert' | 'Update'> & {
      Row: Tables['profiles']['Row'] & { timezone: string | null };
      Insert: Tables['profiles']['Insert'] & { timezone?: string | null };
      Update: Tables['profiles']['Update'] & { timezone?: string | null };
    };
    chat_messages: Omit<Tables['chat_messages'], 'Row'> & {
      Row: Tables['chat_messages']['Row'] & { revision: number; edited_at: string | null };
    };
    library_articles: LibraryTable;
    knowledge_articles: Omit<Tables['knowledge_articles'], 'Row' | 'Insert' | 'Update'> & {
      Row: KnowledgeArticle;
      Insert: Tables['knowledge_articles']['Insert'] & {
        audience?: import('@/features/knowledge/audience').KnowledgeAudience;
      };
      Update: Tables['knowledge_articles']['Update'] & {
        audience?: import('@/features/knowledge/audience').KnowledgeAudience;
      };
    };
    asset_assignments: {
      Row: {
        id: string;
        organization_id: string;
        asset_id: string;
        user_id: string;
        assigned_at: string | null;
        returned_at: string | null;
        recorded_at: string;
      };
      Insert: never;
      Update: never;
      Relationships: [];
    };
    notifications: Omit<Tables['notifications'], 'Row'> & { Row: Notification };
    ticket_messages: Omit<Tables['ticket_messages'], 'Row'> & {
      Row: Omit<Tables['ticket_messages']['Row'], 'author_id'> & {
        author_id: string | null;
        author_type: 'member' | 'automation';
        automation_execution_id: string | null;
        automation_step_id: string | null;
        automation_name: string | null;
      };
    };
    // BEFORE INSERT triggers assign the number and SLA deadlines.
    tickets: Omit<Tables['tickets'], 'Row' | 'Insert'> & {
      Row: Tables['tickets']['Row'] & {
        ticket_type: 'support' | 'incident';
        incident_revision: number;
        request_kind: 'support' | 'inventory';
        revision: number;
        unassigned_since: string | null;
        unassigned_episode_id: string | null;
        waiting_on_user_since: string | null;
        waiting_on_user_episode_id: string | null;
      };
      Insert: Omit<
        Tables['tickets']['Insert'],
        'ticket_number' | 'response_sla_due_at' | 'resolution_sla_due_at'
      >;
    };
    assets: Omit<Tables['assets'], 'Row' | 'Insert' | 'Update'> & {
      Row: Asset;
      Insert: Omit<Tables['assets']['Insert'], keyof AssetFields> & {
        kind: AssetKind;
        status?: AssetStatus;
        end_of_life_on?: string | null;
      };
      Update: Omit<Tables['assets']['Update'], keyof AssetFields> & Partial<AssetFields>;
    };
  };

type RuntimeFunctions = {
  account_authentication_policy: {
    Args: Record<string, never>;
    Returns: import('@/features/auth/workspace-policy').AccountAuthenticationPolicy[];
  };
  save_workspace_security_policy: {
    Args: { org: string; expected_revision: number; require_authenticator: boolean };
    Returns: number;
  };
  save_notification_preferences: {
    Args: { org: string; expected_revision: number; settings: import('./database.generated').Json };
    Returns: number;
  };
  claim_notification_digests: {
    Args: { batch_size?: number };
    Returns: import('@/features/notifications/preferences-model').NotificationDigest[];
  };
  finish_notification_digest: {
    Args: { target: string; token: string; provider_message_id: string | null; failure: boolean };
    Returns: boolean;
  };
  technician_workload: {
    Args: { org: string };
    Returns: {
      user_id: string | null;
      label: string;
      active: boolean;
      open_count: number;
      waiting_count: number;
      overdue_count: number;
    }[];
  };
  import_asset_updates: { Args: { org: string; records: Json; expected: Json }; Returns: number };
  set_inventory_reorder_threshold: {
    Args: { org: string; item: string; threshold: number | null; expected: number | null };
    Returns: undefined;
  };
  process_equipment_reminders: { Args: { batch_size?: number }; Returns: number };
  search_workspace: {
    Args: { org: string; search_text: string };
    Returns: {
      id: string;
      kind: string;
      label: string;
      detail: string;
      audience: string | null;
      shared: boolean;
      approximate: boolean;
      score: number;
    }[];
  };
  library_article_usage: {
    Args: { article: string };
    Returns: { views: number; helpful: number; unhelpful: number; workspaces: number }[];
  };
  suggest_knowledge_articles: {
    Args: { org: string; query: string; category_name?: string };
    Returns: import('@/features/knowledge/suggestions').SuggestedArticle[];
  };
  workspace_library_choices: {
    Args: { org: string; query?: string; page_number?: number };
    Returns: {
      id: string;
      title: string;
      summary: string;
      category: string;
      audience: import('@/features/knowledge/audience').KnowledgeAudience;
      hidden: boolean;
    }[];
  };
  set_library_article_hidden: {
    Args: { org: string; article: string; hide: boolean };
    Returns: undefined;
  };
  record_library_article_view: {
    Args: { target_organization_id: string; target_article_id: string };
    Returns: undefined;
  };
  rate_library_article: {
    Args: { target_organization_id: string; target_article_id: string; is_helpful: boolean };
    Returns: undefined;
  };
  process_idle_chats: { Args: { batch_size?: number }; Returns: Json };
  publish_employee_update: {
    Args: {
      org: string;
      ticket: string;
      expected_revision: number;
      heading: string;
      message: string;
      request_key: string;
      details: import('./database.generated').Json;
    };
    Returns: import('./database.generated').Json;
  };
  incident_report: {
    Args: { org: string; page?: number };
    Returns: import('./database.generated').Json;
  };
} & AutomationFunctions &
  DomainEventFunctions &
  AutomationExecutionFunctions &
  AutomationWorkerFunctions &
  AutomationDryRunFunctions &
  AutomationAdminFunctions &
  InventoryFunctions & {
    edit_chat_message: {
      Args: {
        org: string;
        conversation: string;
        message: string;
        expected_revision: number;
        new_body: string;
      };
      Returns: RoomMessage[];
    };
    search_knowledge_articles: Omit<Functions['search_knowledge_articles'], 'Returns'> & {
      Returns: ReadableArticle[];
    };
    search_tickets: Omit<Functions['search_tickets'], 'Returns'> & {
      Returns: (Functions['search_tickets']['Returns'][number] & {
        ticket_type: 'support' | 'incident';
        request_kind: 'support' | 'inventory';
      })[];
    };
    prepare_member_invitation: {
      Args: {
        org: string;
        token: string;
        email: string;
        display_name: string;
        member_role: AppRole;
        actor: string;
      };
      Returns: { id: string; userId: string | null; completed: boolean };
    };
    complete_member_invitation: {
      Args: { org: string; token: string; invited_user: string; actor: string };
      Returns: undefined;
    };
    manage_workflow_template: {
      Args: {
        org: string;
        target: string;
        expected_revision: number;
        operation: string;
        payload: import('./database.generated').Json;
      };
      Returns: number;
    };
    apply_workflow_template: {
      Args: {
        org: string;
        ticket: string;
        template_id: string;
        version: number;
        token: string;
        expected_ticket_revision: number;
        payload: import('./database.generated').Json;
      };
      Returns: string;
    };
    manage_incident_control: {
      Args: {
        org: string;
        ticket: string;
        target: string;
        expected_revision: number;
        operation: string;
        payload: import('./database.generated').Json;
      };
      Returns: number;
    };
    enqueue_incident_escalations: { Args: Record<string, never>; Returns: number };
    manage_incident_communication: {
      Args: {
        org: string;
        ticket: string;
        target: string;
        expected_revision: number;
        operation: string;
        payload: import('./database.generated').Json;
      };
      Returns: number;
    };
    incident_delivery_summary: {
      Args: { org: string; ticket: string; bulletins: string[] };
      Returns: import('@/features/tickets/communications').DeliverySummary[];
    };
    enqueue_incident_update_reminders: { Args: Record<string, never>; Returns: number };
    change_incident_step: {
      Args: {
        org: string;
        ticket: string;
        step: string;
        expected_revision: number;
        operation: string;
        payload: import('./database.generated').Json;
      };
      Returns: number;
    };
    save_ticket_incident: {
      Args: {
        org: string;
        target: string;
        expected_revision: number;
        payload: import('./database.generated').Json;
      };
      Returns: number;
    };
    submit_incident_ticket: {
      Args: { org: string; token: string; payload: import('./database.generated').Json };
      Returns: string;
    };
    submit_support_request: {
      Args: {
        org: string;
        token: string;
        kind: 'ticket' | 'equipment' | 'chat';
        payload: import('./database.generated').Json;
      };
      Returns: string;
    };
    lookup_choices: {
      Args: {
        org: string;
        resource: string;
        query?: string;
        after_label?: string | null;
        after_id?: string | null;
        selected?: string | null;
        parent?: string | null;
        active_only?: boolean;
      };
      Returns: import('@/features/lookups/model').LookupChoice[];
    };
    start_automation_run: { Args: { kind: string }; Returns: string };
    finish_automation_run: {
      Args: { run_id: string; outcome: string; metrics: import('./database.generated').Json };
      Returns: boolean;
    };
    read_automation_operations: {
      Args: { org: string };
      Returns: import('./database.generated').Json;
    };
    read_automation_operations_history: {
      Args: {
        org: string;
        query?: string;
        trigger_type?: string;
        result_filter?: string;
        since_at?: string | null;
        until_at?: string | null;
        before_at?: string | null;
        before_id?: string | null;
        ticket_number?: number | null;
      };
      Returns: import('./database.generated').Json;
    };
    discover_temporal_automation: {
      Args: { rule_limit?: number; ticket_limit?: number };
      Returns: import('./database.generated').Json;
    };
    create_equipment_ticket: NullableArgs<'create_equipment_ticket', 'category'>;
    record_product_usage: NullableArgs<'record_product_usage', 'org' | 'target_id' | 'event_token'>;
    bootstrap_organization: Omit<Functions['bootstrap_organization'], 'Args'> & {
      Args: Functions['bootstrap_organization']['Args'] & { organization_timezone: string };
    };
    manage_customer: Omit<Functions['manage_customer'], 'Args'> & {
      Args: {
        target: string | null;
        customer_name: string;
        customer_slug?: string | null;
        admin_email?: string | null;
        admin_name?: string | null;
        organization_timezone?: string;
      };
    };
    finish_notification_email: NullableArgs<
      'finish_notification_email',
      'provider_message_id' | 'failure'
    >;
    reopen_ticket: {
      Args: { target: string; expected_revision: number; explanation: string; token: string };
      Returns: number;
    };
    claim_notification_emails: Omit<Functions['claim_notification_emails'], 'Returns'> & {
      Returns: NotificationEmail[];
    };
    custom_report: {
      Args: { target_organization_id: string; report_config: import('./database.generated').Json };
      Returns: import('./database.generated').Json;
    };
    enqueue_scheduled_report_deliveries: { Args: never; Returns: number };
    claim_report_deliveries: {
      Args: { batch_size?: number; lease_seconds?: number };
      Returns: {
        delivery_id: string;
        lease_token: string;
        organization_id: string;
        report_id: string;
        report_name: string;
        definition: CustomReportDefinition;
        recipient_email: string;
        format: 'xlsx' | 'csv' | 'pdf';
        scheduled_for: string;
        attempts: number;
      }[];
    };
    finish_report_delivery: {
      Args: {
        target_id: string;
        token: string;
        provider_id?: string | null;
        failure_code?: string | null;
        snapshot?: string | null;
        report_summary?: import('./database.generated').Json | null;
      };
      Returns: boolean;
    };
    report_delivery_history: { Args: { target_report_id: string }; Returns: ReportDelivery[] };
    rate_ticket_resolution: {
      Args: { target: string; rating: number; remark?: string | null };
      Returns: number;
    };
    satisfaction_summary: {
      Args: { target_organization_id: string; days?: number };
      Returns: import('./database.generated').Json;
    };
    platform_organization_export: {
      Args: { search_text?: string; export_format?: string };
      Returns: import('./database.generated').Json;
    };
    platform_analytics_retention: { Args: never; Returns: import('./database.generated').Json };
    platform_product_usage_cleanup: { Args: never; Returns: import('./database.generated').Json };
    run_product_usage_cleanup: {
      Args: { row_limit?: number };
      Returns: import('./database.generated').Json;
    };
  };

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<Schema, 'Tables' | 'Functions' | 'Enums' | 'Views'> & {
    Enums: Omit<Schema['Enums'], 'notification_kind'> & { notification_kind: NotificationKind };
    Tables: Omit<Tables, keyof RuntimeTables> & RuntimeTables;

    Views: Schema['Views'] & {
      readable_knowledge_articles: { Row: ReadableArticle; Relationships: [] };
    };
    Functions: Omit<Functions, keyof RuntimeFunctions> & RuntimeFunctions;
  };
};
