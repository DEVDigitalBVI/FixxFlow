export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      assets: {
        Row: {
          assigned_user_id: string | null
          created_at: string
          id: string
          kind: string
          location_id: string | null
          model: string | null
          name: string
          organization_id: string
          purchased_on: string | null
          revision: number
          search_document: unknown
          serial_number: string | null
          status: string
          tag: string
          updated_at: string
          warranty_until: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          created_at?: string
          id?: string
          kind: string
          location_id?: string | null
          model?: string | null
          name: string
          organization_id: string
          purchased_on?: string | null
          revision?: number
          search_document?: unknown
          serial_number?: string | null
          status?: string
          tag: string
          updated_at?: string
          warranty_until?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          location_id?: string | null
          model?: string | null
          name?: string
          organization_id?: string
          purchased_on?: string | null
          revision?: number
          search_document?: unknown
          serial_number?: string | null
          status?: string
          tag?: string
          updated_at?: string
          warranty_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_organization_id_assigned_user_id_fkey"
            columns: ["organization_id", "assigned_user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          changes: Json
          created_at: string
          entity_id: string
          entity_label: string
          entity_type: string
          id: number
          organization_id: string
          search_text: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name: string
          changes?: Json
          created_at?: string
          entity_id: string
          entity_label: string
          entity_type: string
          id?: never
          organization_id: string
          search_text?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          changes?: Json
          created_at?: string
          entity_id?: string
          entity_label?: string
          entity_type?: string
          id?: never
          organization_id?: string
          search_text?: string | null
        }
        Relationships: []
      }
      automation_execution_steps: {
        Row: {
          action_id: string
          action_type: string
          attempts: number
          completed_at: string | null
          duration_ms: number | null
          error_code: string | null
          execution_id: string
          id: string
          idempotency_key: string
          organization_id: string
          position: number
          result: Json | null
          started_at: string | null
          status: string
        }
        Insert: {
          action_id: string
          action_type: string
          attempts?: number
          completed_at?: string | null
          duration_ms?: number | null
          error_code?: string | null
          execution_id: string
          id?: string
          idempotency_key?: string
          organization_id: string
          position: number
          result?: Json | null
          started_at?: string | null
          status: string
        }
        Update: {
          action_id?: string
          action_type?: string
          attempts?: number
          completed_at?: string | null
          duration_ms?: number | null
          error_code?: string | null
          execution_id?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          position?: number
          result?: Json | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_execution_steps_organization_id_execution_id_fkey"
            columns: ["organization_id", "execution_id"]
            isOneToOne: false
            referencedRelation: "automation_executions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      automation_executions: {
        Row: {
          actions_attempted: number
          causation_id: string | null
          completed_at: string | null
          conditions: Json
          correlation_id: string
          delivery_id: string
          depth: number
          duration_ms: number | null
          entity_id: string
          entity_type: string
          error_code: string | null
          event_id: string
          expected_entity_revision: number
          id: string
          organization_id: string
          processing_generation: number
          root_event_id: string
          rule_id: string
          rule_name: string
          rule_version: number
          started_at: string
          status: string
          trigger_type: string
        }
        Insert: {
          actions_attempted?: number
          causation_id?: string | null
          completed_at?: string | null
          conditions: Json
          correlation_id: string
          delivery_id: string
          depth: number
          duration_ms?: number | null
          entity_id: string
          entity_type: string
          error_code?: string | null
          event_id: string
          expected_entity_revision: number
          id?: string
          organization_id: string
          processing_generation: number
          root_event_id: string
          rule_id: string
          rule_name: string
          rule_version: number
          started_at?: string
          status: string
          trigger_type: string
        }
        Update: {
          actions_attempted?: number
          causation_id?: string | null
          completed_at?: string | null
          conditions?: Json
          correlation_id?: string
          delivery_id?: string
          depth?: number
          duration_ms?: number | null
          entity_id?: string
          entity_type?: string
          error_code?: string | null
          event_id?: string
          expected_entity_revision?: number
          id?: string
          organization_id?: string
          processing_generation?: number
          root_event_id?: string
          rule_id?: string
          rule_name?: string
          rule_version?: number
          started_at?: string
          status?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_executions_organization_id_rule_id_rule_version_fkey"
            columns: ["organization_id", "rule_id", "rule_version"]
            isOneToOne: false
            referencedRelation: "automation_rule_versions"
            referencedColumns: ["organization_id", "rule_id", "version"]
          },
        ]
      }
      automation_rule_versions: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          definition: Json
          enabled: boolean
          enabled_at: string | null
          organization_id: string
          rule_id: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          definition: Json
          enabled: boolean
          enabled_at?: string | null
          organization_id: string
          rule_id: string
          version: number
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          definition?: Json
          enabled?: boolean
          enabled_at?: string | null
          organization_id?: string
          rule_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_rule_versions_organization_id_created_by_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "automation_rule_versions_organization_id_rule_id_fkey"
            columns: ["organization_id", "rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          actions: Json | null
          archived_at: string | null
          conditions: Json | null
          created_at: string
          created_by: string
          definition: Json
          description: string | null
          enabled: boolean
          enabled_at: string | null
          id: string
          name: string | null
          organization_id: string
          trigger_configuration: Json | null
          trigger_type: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          actions?: Json | null
          archived_at?: string | null
          conditions?: Json | null
          created_at?: string
          created_by: string
          definition: Json
          description?: string | null
          enabled?: boolean
          enabled_at?: string | null
          id?: string
          name?: string | null
          organization_id: string
          trigger_configuration?: Json | null
          trigger_type?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          actions?: Json | null
          archived_at?: string | null
          conditions?: Json | null
          created_at?: string
          created_by?: string
          definition?: Json
          description?: string | null
          enabled?: boolean
          enabled_at?: string | null
          id?: string
          name?: string | null
          organization_id?: string
          trigger_configuration?: Json | null
          trigger_type?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_organization_id_created_by_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "automation_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rules_organization_id_updated_by_fkey"
            columns: ["organization_id", "updated_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      chat_attachments: {
        Row: {
          content_type: string
          conversation_id: string
          created_at: string
          file_name: string
          id: string
          organization_id: string
          size_bytes: number
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          content_type: string
          conversation_id: string
          created_at?: string
          file_name: string
          id?: string
          organization_id: string
          size_bytes: number
          storage_path: string
          uploaded_by: string
        }
        Update: {
          content_type?: string
          conversation_id?: string
          created_at?: string
          file_name?: string
          id?: string
          organization_id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_attachments_organization_id_conversation_id_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "chat_attachments_organization_id_uploaded_by_fkey"
            columns: ["organization_id", "uploaded_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          assigned_technician_id: string | null
          closed_at: string | null
          created_at: string
          id: string
          organization_id: string
          requester_id: string
          status: Database["public"]["Enums"]["chat_status"]
          ticket_id: string | null
          topic: string
          updated_at: string
        }
        Insert: {
          assigned_technician_id?: string | null
          closed_at?: string | null
          created_at?: string
          id?: string
          organization_id: string
          requester_id: string
          status?: Database["public"]["Enums"]["chat_status"]
          ticket_id?: string | null
          topic: string
          updated_at?: string
        }
        Update: {
          assigned_technician_id?: string | null
          closed_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          requester_id?: string
          status?: Database["public"]["Enums"]["chat_status"]
          ticket_id?: string | null
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_organization_id_assigned_technician_id_fkey"
            columns: ["organization_id", "assigned_technician_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "chat_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_organization_id_requester_id_fkey"
            columns: ["organization_id", "requester_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "chat_conversations_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: true
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          author_id: string
          body: string
          conversation_id: string
          created_at: string
          edited_at: string | null
          id: string
          kind: Database["public"]["Enums"]["chat_message_kind"]
          organization_id: string
          revision: number
        }
        Insert: {
          author_id: string
          body: string
          conversation_id: string
          created_at?: string
          edited_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["chat_message_kind"]
          organization_id: string
          revision?: number
        }
        Update: {
          author_id?: string
          body?: string
          conversation_id?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["chat_message_kind"]
          organization_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_organization_id_author_id_fkey"
            columns: ["organization_id", "author_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "chat_messages_organization_id_conversation_id_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_approval_history: {
        Row: {
          action: string
          actor_id: string
          approval_id: string
          created_at: string
          id: number
          organization_id: string
          snapshot: Json
          ticket_id: string
        }
        Insert: {
          action: string
          actor_id: string
          approval_id: string
          created_at?: string
          id?: never
          organization_id: string
          snapshot: Json
          ticket_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          approval_id?: string
          created_at?: string
          id?: never
          organization_id?: string
          snapshot?: Json
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_approval_history_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "incident_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_approval_history_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      incident_approvals: {
        Row: {
          approver_id: string
          backup_approver_id: string | null
          decided_at: string | null
          decision_by: string | null
          decision_note: string | null
          description: string
          due_at: string
          id: string
          organization_id: string
          requested_at: string
          requested_by: string
          revision: number
          status: string
          step_id: string | null
          step_snapshot: Json | null
          step_work_version: number | null
          superseded_by: string | null
          ticket_id: string
          title: string
        }
        Insert: {
          approver_id: string
          backup_approver_id?: string | null
          decided_at?: string | null
          decision_by?: string | null
          decision_note?: string | null
          description: string
          due_at: string
          id: string
          organization_id: string
          requested_at?: string
          requested_by: string
          revision?: number
          status?: string
          step_id?: string | null
          step_snapshot?: Json | null
          step_work_version?: number | null
          superseded_by?: string | null
          ticket_id: string
          title: string
        }
        Update: {
          approver_id?: string
          backup_approver_id?: string | null
          decided_at?: string | null
          decision_by?: string | null
          decision_note?: string | null
          description?: string
          due_at?: string
          id?: string
          organization_id?: string
          requested_at?: string
          requested_by?: string
          revision?: number
          status?: string
          step_id?: string | null
          step_snapshot?: Json | null
          step_work_version?: number | null
          superseded_by?: string | null
          ticket_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_approvals_organization_id_approver_id_fkey"
            columns: ["organization_id", "approver_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "incident_approvals_organization_id_backup_approver_id_fkey"
            columns: ["organization_id", "backup_approver_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "incident_approvals_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "incident_approvals_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "incident_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_approvals_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "incident_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_approvals_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "ticket_workflows"
            referencedColumns: ["ticket_id"]
          },
        ]
      }
      incident_bulletin_recipients: {
        Row: {
          bulletin_id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          bulletin_id: string
          organization_id: string
          user_id: string
        }
        Update: {
          bulletin_id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_bulletin_recipients_organization_id_bulletin_id_fkey"
            columns: ["organization_id", "bulletin_id"]
            isOneToOne: false
            referencedRelation: "incident_bulletins"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "incident_bulletin_recipients_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      incident_bulletins: {
        Row: {
          approved_at: string
          approved_by: string
          body: string
          id: string
          next_update_at: string | null
          organization_id: string
          prepared_by: string
          recipient_count: number
          ticket_id: string
          title: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          body: string
          id: string
          next_update_at?: string | null
          organization_id: string
          prepared_by: string
          recipient_count: number
          ticket_id: string
          title: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          body?: string
          id?: string
          next_update_at?: string | null
          organization_id?: string
          prepared_by?: string
          recipient_count?: number
          ticket_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_bulletins_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "incident_update_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_bulletins_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      incident_communication_plans: {
        Row: {
          next_update_at: string | null
          organization_id: string
          owner_id: string
          reminded_at: string | null
          revision: number
          ticket_id: string
          updated_at: string
        }
        Insert: {
          next_update_at?: string | null
          organization_id: string
          owner_id: string
          reminded_at?: string | null
          revision?: number
          ticket_id: string
          updated_at?: string
        }
        Update: {
          next_update_at?: string | null
          organization_id?: string
          owner_id?: string
          reminded_at?: string | null
          revision?: number
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_communication_plans_organization_id_owner_id_fkey"
            columns: ["organization_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "incident_communication_plans_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "incident_communication_plans_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "ticket_workflows"
            referencedColumns: ["ticket_id"]
          },
        ]
      }
      incident_control_history: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: number
          organization_id: string
          snapshot: Json
          ticket_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: never
          organization_id: string
          snapshot: Json
          ticket_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: never
          organization_id?: string
          snapshot?: Json
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_control_history_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      incident_escalation_policies: {
        Row: {
          acknowledgement_minutes: number
          backup_owner_id: string | null
          enabled: boolean
          organization_id: string
          overdue_minutes: number
          revision: number
          ticket_id: string
          updated_at: string
        }
        Insert: {
          acknowledgement_minutes?: number
          backup_owner_id?: string | null
          enabled?: boolean
          organization_id: string
          overdue_minutes?: number
          revision?: number
          ticket_id: string
          updated_at?: string
        }
        Update: {
          acknowledgement_minutes?: number
          backup_owner_id?: string | null
          enabled?: boolean
          organization_id?: string
          overdue_minutes?: number
          revision?: number
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_escalation_policies_organization_id_backup_owner__fkey"
            columns: ["organization_id", "backup_owner_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "incident_escalation_policies_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "incident_escalation_policies_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "ticket_workflows"
            referencedColumns: ["ticket_id"]
          },
        ]
      }
      incident_escalations: {
        Row: {
          created_at: string
          event_key: string
          id: number
          organization_id: string
          reason: string
          recipient_ids: string[]
          target_id: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          event_key: string
          id?: never
          organization_id: string
          reason: string
          recipient_ids: string[]
          target_id: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          event_key?: string
          id?: never
          organization_id?: string
          reason?: string
          recipient_ids?: string[]
          target_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_escalations_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      incident_stakeholder_groups: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          name: string
          organization_id: string
          revision: number
          ticket_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id: string
          name: string
          organization_id: string
          revision?: number
          ticket_id: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          revision?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_stakeholder_groups_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "incident_stakeholder_groups_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "ticket_workflows"
            referencedColumns: ["ticket_id"]
          },
        ]
      }
      incident_stakeholder_members: {
        Row: {
          group_id: string
          organization_id: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          group_id: string
          organization_id: string
          ticket_id: string
          user_id: string
        }
        Update: {
          group_id?: string
          organization_id?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_stakeholder_members_organization_id_ticket_id_gro_fkey"
            columns: ["organization_id", "ticket_id", "group_id"]
            isOneToOne: false
            referencedRelation: "incident_stakeholder_groups"
            referencedColumns: ["organization_id", "ticket_id", "id"]
          },
          {
            foreignKeyName: "incident_stakeholder_members_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      incident_step_history: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: number
          organization_id: string
          snapshot: Json
          step_id: string
          ticket_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: never
          organization_id: string
          snapshot: Json
          step_id: string
          ticket_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: never
          organization_id?: string
          snapshot?: Json
          step_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_step_history_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "incident_step_history_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "incident_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_steps: {
        Row: {
          acknowledged_at: string | null
          application_id: string | null
          assignee_id: string
          assignment_started_at: string | null
          assignment_token: string
          completed_at: string | null
          created_at: string
          due_at: string | null
          id: string
          instructions: string
          organization_id: string
          procedure_position: number | null
          revision: number
          ticket_id: string
          title: string
          updated_at: string
          work_version: number
        }
        Insert: {
          acknowledged_at?: string | null
          application_id?: string | null
          assignee_id: string
          assignment_started_at?: string | null
          assignment_token?: string
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          id: string
          instructions?: string
          organization_id: string
          procedure_position?: number | null
          revision?: number
          ticket_id: string
          title: string
          updated_at?: string
          work_version?: number
        }
        Update: {
          acknowledged_at?: string | null
          application_id?: string | null
          assignee_id?: string
          assignment_started_at?: string | null
          assignment_token?: string
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          instructions?: string
          organization_id?: string
          procedure_position?: number | null
          revision?: number
          ticket_id?: string
          title?: string
          updated_at?: string
          work_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "incident_steps_organization_id_application_id_fkey"
            columns: ["organization_id", "application_id"]
            isOneToOne: false
            referencedRelation: "ticket_workflow_applications"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "incident_steps_organization_id_assignee_id_fkey"
            columns: ["organization_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "incident_steps_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "incident_steps_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "ticket_workflows"
            referencedColumns: ["ticket_id"]
          },
        ]
      }
      incident_update_drafts: {
        Row: {
          body: string
          created_at: string
          created_by: string
          group_ids: string[]
          group_names: string[]
          id: string
          next_update_at: string | null
          organization_id: string
          recipient_ids: string[]
          revision: number
          status: string
          ticket_id: string
          title: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          group_ids: string[]
          group_names: string[]
          id: string
          next_update_at?: string | null
          organization_id: string
          recipient_ids: string[]
          revision?: number
          status?: string
          ticket_id: string
          title: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          group_ids?: string[]
          group_names?: string[]
          id?: string
          next_update_at?: string | null
          organization_id?: string
          recipient_ids?: string[]
          revision?: number
          status?: string
          ticket_id?: string
          title?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_update_drafts_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "incident_update_drafts_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "ticket_workflows"
            referencedColumns: ["ticket_id"]
          },
        ]
      }
      inventory_equipment: {
        Row: {
          asset_context: Json
          asset_id: string
          item_id: string
          organization_id: string
          request_id: string | null
          state: string
        }
        Insert: {
          asset_context: Json
          asset_id: string
          item_id: string
          organization_id: string
          request_id?: string | null
          state?: string
        }
        Update: {
          asset_context?: Json
          asset_id?: string
          item_id?: string
          organization_id?: string
          request_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_equipment_organization_id_asset_id_fkey"
            columns: ["organization_id", "asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inventory_equipment_organization_id_item_id_fkey"
            columns: ["organization_id", "item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inventory_equipment_organization_id_request_id_fkey"
            columns: ["organization_id", "request_id"]
            isOneToOne: false
            referencedRelation: "inventory_requests"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          created_at: string
          department_id: string
          department_name: string
          id: string
          kind: string
          location_id: string
          location_name: string
          name: string
          organization_id: string
          reserved: number
          stock: number
        }
        Insert: {
          created_at?: string
          department_id: string
          department_name: string
          id?: string
          kind: string
          location_id: string
          location_name: string
          name: string
          organization_id: string
          reserved?: number
          stock?: number
        }
        Update: {
          created_at?: string
          department_id?: string
          department_name?: string
          id?: string
          kind?: string
          location_id?: string
          location_name?: string
          name?: string
          organization_id?: string
          reserved?: number
          stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_organization_id_department_id_fkey"
            columns: ["organization_id", "department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inventory_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      inventory_managers: {
        Row: {
          organization_id: string
          user_id: string
        }
        Insert: {
          organization_id: string
          user_id: string
        }
        Update: {
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_managers_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: true
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          actor_id: string | null
          actor_name: string
          context: Json
          created_at: string
          id: string
          item_id: string
          kind: string
          note: string
          organization_id: string
          quantity: number
          request_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name: string
          context: Json
          created_at?: string
          id?: string
          item_id: string
          kind: string
          note?: string
          organization_id: string
          quantity: number
          request_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          context?: Json
          created_at?: string
          id?: string
          item_id?: string
          kind?: string
          note?: string
          organization_id?: string
          quantity?: number
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_organization_id_actor_id_fkey"
            columns: ["organization_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "inventory_movements_organization_id_item_id_fkey"
            columns: ["organization_id", "item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inventory_movements_organization_id_request_id_fkey"
            columns: ["organization_id", "request_id"]
            isOneToOne: false
            referencedRelation: "inventory_requests"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      inventory_requesters: {
        Row: {
          department_id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          department_id: string
          organization_id: string
          user_id: string
        }
        Update: {
          department_id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_requesters_organization_id_department_id_fkey"
            columns: ["organization_id", "department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inventory_requesters_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      inventory_requests: {
        Row: {
          context: Json
          created_at: string
          decision_reason: string | null
          department_id: string
          destination: string
          id: string
          issued_at: string | null
          issued_by: string | null
          item_id: string
          organization_id: string
          printer_id: string | null
          quantity: number
          reason: string
          recipient_id: string | null
          requester_id: string
          state: string
          ticket_id: string
        }
        Insert: {
          context: Json
          created_at?: string
          decision_reason?: string | null
          department_id: string
          destination: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          item_id: string
          organization_id: string
          printer_id?: string | null
          quantity: number
          reason?: string
          recipient_id?: string | null
          requester_id: string
          state?: string
          ticket_id: string
        }
        Update: {
          context?: Json
          created_at?: string
          decision_reason?: string | null
          department_id?: string
          destination?: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          item_id?: string
          organization_id?: string
          printer_id?: string | null
          quantity?: number
          reason?: string
          recipient_id?: string | null
          requester_id?: string
          state?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_requests_organization_id_department_id_fkey"
            columns: ["organization_id", "department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inventory_requests_organization_id_issued_by_fkey"
            columns: ["organization_id", "issued_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "inventory_requests_organization_id_item_id_fkey"
            columns: ["organization_id", "item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inventory_requests_organization_id_printer_id_fkey"
            columns: ["organization_id", "printer_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "inventory_requests_organization_id_recipient_id_fkey"
            columns: ["organization_id", "recipient_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "inventory_requests_organization_id_requester_id_fkey"
            columns: ["organization_id", "requester_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "inventory_requests_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      knowledge_article_feedback: {
        Row: {
          article_id: string
          helpful: boolean
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          article_id: string
          helpful: boolean
          organization_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          article_id?: string
          helpful?: boolean
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_article_feedback_organization_id_article_id_fkey"
            columns: ["organization_id", "article_id"]
            isOneToOne: false
            referencedRelation: "knowledge_articles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "knowledge_article_feedback_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      knowledge_article_views: {
        Row: {
          article_id: string
          organization_id: string
          user_id: string
          viewed_on: string
        }
        Insert: {
          article_id: string
          organization_id: string
          user_id?: string
          viewed_on?: string
        }
        Update: {
          article_id?: string
          organization_id?: string
          user_id?: string
          viewed_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_article_views_organization_id_article_id_fkey"
            columns: ["organization_id", "article_id"]
            isOneToOne: false
            referencedRelation: "knowledge_articles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "knowledge_article_views_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      knowledge_articles: {
        Row: {
          audience: string
          author_id: string | null
          category: string
          content: Json
          created_at: string
          id: string
          organization_id: string
          related_article_ids: string[]
          revision: number
          search_body: string
          status: string
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string
          author_id?: string | null
          category: string
          content?: Json
          created_at?: string
          id?: string
          organization_id: string
          related_article_ids?: string[]
          revision?: number
          search_body?: string
          status?: string
          summary?: string
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string
          author_id?: string | null
          category?: string
          content?: Json
          created_at?: string
          id?: string
          organization_id?: string
          related_article_ids?: string[]
          revision?: number
          search_body?: string
          status?: string
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_articles_organization_id_author_id_fkey"
            columns: ["organization_id", "author_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "knowledge_articles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_attachments: {
        Row: {
          article_id: string
          content_type: string
          created_at: string
          file_name: string
          id: string
          organization_id: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          article_id: string
          content_type: string
          created_at?: string
          file_name: string
          id?: string
          organization_id: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          article_id?: string
          content_type?: string
          created_at?: string
          file_name?: string
          id?: string
          organization_id?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_attachments_organization_id_article_id_fkey"
            columns: ["organization_id", "article_id"]
            isOneToOne: false
            referencedRelation: "knowledge_articles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      locations: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          country_code: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          postal_code: string | null
          region: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          postal_code?: string | null
          region?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          postal_code?: string | null
          region?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          conversation_id: string | null
          created_at: string
          event_key: string
          id: string
          incident_bulletin_id: string | null
          kind: Database["public"]["Enums"]["notification_kind"]
          organization_id: string
          read_at: string | null
          recipient_id: string
          staff_only: boolean
          ticket_id: string | null
          title: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          event_key: string
          id?: string
          incident_bulletin_id?: string | null
          kind: Database["public"]["Enums"]["notification_kind"]
          organization_id: string
          read_at?: string | null
          recipient_id: string
          staff_only?: boolean
          ticket_id?: string | null
          title: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          event_key?: string
          id?: string
          incident_bulletin_id?: string | null
          kind?: Database["public"]["Enums"]["notification_kind"]
          organization_id?: string
          read_at?: string | null
          recipient_id?: string
          staff_only?: boolean
          ticket_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_incident_bulletin_id_fkey"
            columns: ["incident_bulletin_id"]
            isOneToOne: false
            referencedRelation: "incident_bulletins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_conversation_id_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_recipient_id_fkey"
            columns: ["organization_id", "recipient_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "notifications_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          activated_at: string
          created_at: string
          deactivated_at: string | null
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string
          created_at?: string
          deactivated_at?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string
          created_at?: string
          deactivated_at?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          logo_path: string | null
          name: string
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name: string
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name?: string
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_usage_preferences: {
        Row: {
          enabled: boolean
          user_id: string
        }
        Insert: {
          enabled?: boolean
          user_id: string
        }
        Update: {
          enabled?: boolean
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          department_id: string | null
          display_name: string
          email: string | null
          job_title: string | null
          location_id: string | null
          organization_id: string
          phone: string | null
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          department_id?: string | null
          display_name: string
          email?: string | null
          job_title?: string | null
          location_id?: string | null
          organization_id: string
          phone?: string | null
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          department_id?: string | null
          display_name?: string
          email?: string | null
          job_title?: string | null
          location_id?: string | null
          organization_id?: string
          phone?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_department_id_fkey"
            columns: ["organization_id", "department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "profiles_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "profiles_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: true
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      report_schedules: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          format: string
          frequency: string
          id: string
          last_enqueued_at: string | null
          monthday: number | null
          next_run_at: string
          organization_id: string
          recipient_emails: string[]
          report_id: string
          run_hour: number
          timezone: string
          updated_at: string
          weekday: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          format?: string
          frequency: string
          id?: string
          last_enqueued_at?: string | null
          monthday?: number | null
          next_run_at: string
          organization_id: string
          recipient_emails: string[]
          report_id: string
          run_hour: number
          timezone: string
          updated_at?: string
          weekday?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          format?: string
          frequency?: string
          id?: string
          last_enqueued_at?: string | null
          monthday?: number | null
          next_run_at?: string
          organization_id?: string
          recipient_emails?: string[]
          report_id?: string
          run_hour?: number
          timezone?: string
          updated_at?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_organization_id_created_by_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "report_schedules_organization_id_report_id_fkey"
            columns: ["organization_id", "report_id"]
            isOneToOne: false
            referencedRelation: "saved_reports"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      saved_replies: {
        Row: {
          body: string
          created_at: string
          created_by: string
          id: string
          organization_id: string
          revision: number
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          revision?: number
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          revision?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_replies_organization_id_created_by_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "saved_replies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_reports: {
        Row: {
          created_at: string
          definition: Json
          description: string | null
          id: string
          name: string
          organization_id: string
          owner_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          definition: Json
          description?: string | null
          id?: string
          name: string
          organization_id: string
          owner_id: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          definition?: Json
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          owner_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_reports_organization_id_owner_id_fkey"
            columns: ["organization_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_activity: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          id: number
          organization_id: string
          ticket_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          organization_id: string
          ticket_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          organization_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_activity_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ticket_assets: {
        Row: {
          asset_id: string
          created_at: string
          organization_id: string
          ticket_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          organization_id: string
          ticket_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          organization_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_assets_organization_id_asset_id_fkey"
            columns: ["organization_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ticket_assets_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ticket_attachments: {
        Row: {
          content_type: string
          created_at: string
          file_name: string
          id: string
          organization_id: string
          size_bytes: number
          storage_path: string
          ticket_id: string
          uploaded_by: string
        }
        Insert: {
          content_type: string
          created_at?: string
          file_name: string
          id?: string
          organization_id: string
          size_bytes: number
          storage_path: string
          ticket_id: string
          uploaded_by: string
        }
        Update: {
          content_type?: string
          created_at?: string
          file_name?: string
          id?: string
          organization_id?: string
          size_bytes?: number
          storage_path?: string
          ticket_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ticket_attachments_organization_id_uploaded_by_fkey"
            columns: ["organization_id", "uploaded_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      ticket_categories: {
        Row: {
          created_at: string
          default_team_id: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_team_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_team_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_categories_default_team_fk"
            columns: ["organization_id", "default_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ticket_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_incidents: {
        Row: {
          affected_locations: string[]
          affected_services: string[]
          business_impact: string
          created_at: string
          organization_id: string
          owner_id: string
          severity: string
          ticket_id: string
          updated_at: string
        }
        Insert: {
          affected_locations?: string[]
          affected_services?: string[]
          business_impact: string
          created_at?: string
          organization_id: string
          owner_id: string
          severity: string
          ticket_id: string
          updated_at?: string
        }
        Update: {
          affected_locations?: string[]
          affected_services?: string[]
          business_impact?: string
          created_at?: string
          organization_id?: string
          owner_id?: string
          severity?: string
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_incidents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_incidents_organization_id_owner_id_fkey"
            columns: ["organization_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "ticket_incidents_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ticket_messages: {
        Row: {
          author_id: string | null
          author_type: string
          automation_execution_id: string | null
          automation_name: string | null
          automation_step_id: string | null
          body: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["ticket_message_kind"]
          organization_id: string
          ticket_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_type?: string
          automation_execution_id?: string | null
          automation_name?: string | null
          automation_step_id?: string | null
          body: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["ticket_message_kind"]
          organization_id: string
          ticket_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_type?: string
          automation_execution_id?: string | null
          automation_name?: string | null
          automation_step_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["ticket_message_kind"]
          organization_id?: string
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_organization_id_author_id_fkey"
            columns: ["organization_id", "author_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "ticket_messages_organization_id_automation_execution_id_au_fkey"
            columns: [
              "organization_id",
              "automation_execution_id",
              "automation_step_id",
            ]
            isOneToOne: false
            referencedRelation: "automation_execution_steps"
            referencedColumns: ["organization_id", "execution_id", "id"]
          },
          {
            foreignKeyName: "ticket_messages_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ticket_subcategories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_subcategories_organization_id_category_id_fkey"
            columns: ["organization_id", "category_id"]
            isOneToOne: false
            referencedRelation: "ticket_categories"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ticket_tags: {
        Row: {
          created_at: string
          created_by: string
          organization_id: string
          tag: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          organization_id: string
          tag: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          organization_id?: string
          tag?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_tags_organization_id_created_by_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "ticket_tags_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ticket_workflow_applications: {
        Row: {
          applied_at: string
          applied_by: string
          assignment_snapshot: Json
          definition_snapshot: Json
          fingerprint: string
          group_ids: string[]
          id: string
          organization_id: string
          step_ids: string[]
          template_id: string
          template_version: number
          ticket_id: string
        }
        Insert: {
          applied_at?: string
          applied_by: string
          assignment_snapshot: Json
          definition_snapshot: Json
          fingerprint: string
          group_ids?: string[]
          id: string
          organization_id: string
          step_ids: string[]
          template_id: string
          template_version: number
          ticket_id: string
        }
        Update: {
          applied_at?: string
          applied_by?: string
          assignment_snapshot?: Json
          definition_snapshot?: Json
          fingerprint?: string
          group_ids?: string[]
          id?: string
          organization_id?: string
          step_ids?: string[]
          template_id?: string
          template_version?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_workflow_applications_organization_id_template_id_t_fkey"
            columns: ["organization_id", "template_id", "template_version"]
            isOneToOne: false
            referencedRelation: "workflow_template_versions"
            referencedColumns: ["organization_id", "template_id", "version"]
          },
          {
            foreignKeyName: "ticket_workflow_applications_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ticket_workflow_applications_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "ticket_workflows"
            referencedColumns: ["ticket_id"]
          },
        ]
      }
      ticket_workflows: {
        Row: {
          created_at: string
          kind: string
          organization_id: string
          owner_id: string
          revision: number
          ticket_id: string
        }
        Insert: {
          created_at?: string
          kind: string
          organization_id: string
          owner_id: string
          revision?: number
          ticket_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          organization_id?: string
          owner_id?: string
          revision?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_workflows_organization_id_owner_id_fkey"
            columns: ["organization_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "ticket_workflows_organization_id_ticket_id_fkey"
            columns: ["organization_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      tickets: {
        Row: {
          assigned_technician_id: string | null
          category_id: string | null
          closed_at: string | null
          created_at: string
          description: string
          due_at: string | null
          first_response_at: string | null
          id: string
          incident_revision: number
          location_id: string | null
          organization_id: string
          priority: Database["public"]["Enums"]["ticket_priority"]
          reported_impact: string | null
          request_kind: string
          requester_id: string
          resolution_sla_due_at: string
          resolved_at: string | null
          response_sla_due_at: string
          revision: number
          routing_mode: string
          sla_next_due_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subcategory_id: string | null
          team_id: string | null
          ticket_number: number
          ticket_type: string
          title: string
          unassigned_episode_id: string | null
          unassigned_since: string | null
          updated_at: string
          waiting_on_user_episode_id: string | null
          waiting_on_user_since: string | null
        }
        Insert: {
          assigned_technician_id?: string | null
          category_id?: string | null
          closed_at?: string | null
          created_at?: string
          description: string
          due_at?: string | null
          first_response_at?: string | null
          id?: string
          incident_revision?: number
          location_id?: string | null
          organization_id: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          reported_impact?: string | null
          request_kind?: string
          requester_id: string
          resolution_sla_due_at: string
          resolved_at?: string | null
          response_sla_due_at: string
          revision?: number
          routing_mode?: string
          sla_next_due_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subcategory_id?: string | null
          team_id?: string | null
          ticket_number: number
          ticket_type?: string
          title: string
          unassigned_episode_id?: string | null
          unassigned_since?: string | null
          updated_at?: string
          waiting_on_user_episode_id?: string | null
          waiting_on_user_since?: string | null
        }
        Update: {
          assigned_technician_id?: string | null
          category_id?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string
          due_at?: string | null
          first_response_at?: string | null
          id?: string
          incident_revision?: number
          location_id?: string | null
          organization_id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          reported_impact?: string | null
          request_kind?: string
          requester_id?: string
          resolution_sla_due_at?: string
          resolved_at?: string | null
          response_sla_due_at?: string
          revision?: number
          routing_mode?: string
          sla_next_due_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subcategory_id?: string | null
          team_id?: string | null
          ticket_number?: number
          ticket_type?: string
          title?: string
          unassigned_episode_id?: string | null
          unassigned_since?: string | null
          updated_at?: string
          waiting_on_user_episode_id?: string | null
          waiting_on_user_since?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_organization_id_assigned_technician_id_fkey"
            columns: ["organization_id", "assigned_technician_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "tickets_organization_id_category_id_fkey"
            columns: ["organization_id", "category_id"]
            isOneToOne: false
            referencedRelation: "ticket_categories"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "tickets_organization_id_category_id_subcategory_id_fkey"
            columns: ["organization_id", "category_id", "subcategory_id"]
            isOneToOne: false
            referencedRelation: "ticket_subcategories"
            referencedColumns: ["organization_id", "category_id", "id"]
          },
          {
            foreignKeyName: "tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "tickets_organization_id_requester_id_fkey"
            columns: ["organization_id", "requester_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "tickets_organization_id_team_id_fkey"
            columns: ["organization_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      workflow_template_drafts: {
        Row: {
          definition: Json
          organization_id: string
          template_id: string
          updated_at: string
        }
        Insert: {
          definition: Json
          organization_id: string
          template_id: string
          updated_at?: string
        }
        Update: {
          definition?: Json
          organization_id?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_template_drafts_organization_id_template_id_fkey"
            columns: ["organization_id", "template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      workflow_template_versions: {
        Row: {
          change_note: string
          definition: Json
          organization_id: string
          published_at: string
          published_by: string
          template_id: string
          version: number
        }
        Insert: {
          change_note: string
          definition: Json
          organization_id: string
          published_at?: string
          published_by: string
          template_id: string
          version: number
        }
        Update: {
          change_note?: string
          definition?: Json
          organization_id?: string
          published_at?: string
          published_by?: string
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflow_template_versions_organization_id_template_id_fkey"
            columns: ["organization_id", "template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          archived: boolean
          created_at: string
          created_by: string
          description: string
          id: string
          kind: string
          latest_version: number
          name: string
          organization_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          created_by: string
          description: string
          id: string
          kind: string
          latest_version?: number
          name: string
          organization_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          kind?: string
          latest_version?: number
          name?: string
          organization_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_workflow_template: {
        Args: {
          expected_ticket_revision: number
          org: string
          payload: Json
          template_id: string
          ticket: string
          token: string
          version: number
        }
        Returns: string
      }
      archive_automation_rule: {
        Args: {
          expected_version: number
          rule_id: string
          target_organization_id: string
        }
        Returns: {
          actions: Json | null
          archived_at: string | null
          conditions: Json | null
          created_at: string
          created_by: string
          definition: Json
          description: string | null
          enabled: boolean
          enabled_at: string | null
          id: string
          name: string | null
          organization_id: string
          trigger_configuration: Json | null
          trigger_type: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "automation_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      begin_automation_execution: {
        Args: {
          delivery_id: string
          rule_id: string
          rule_version: number
          token: string
        }
        Returns: {
          actions_attempted: number
          causation_id: string | null
          completed_at: string | null
          conditions: Json
          correlation_id: string
          delivery_id: string
          depth: number
          duration_ms: number | null
          entity_id: string
          entity_type: string
          error_code: string | null
          event_id: string
          expected_entity_revision: number
          id: string
          organization_id: string
          processing_generation: number
          root_event_id: string
          rule_id: string
          rule_name: string
          rule_version: number
          started_at: string
          status: string
          trigger_type: string
        }
        SetofOptions: {
          from: "*"
          to: "automation_executions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bootstrap_organization:
        | {
            Args: {
              administrator_name: string
              administrator_user_id: string
              organization_name: string
              organization_slug: string
            }
            Returns: string
          }
        | {
            Args: {
              administrator_name: string
              administrator_user_id: string
              organization_name: string
              organization_slug: string
              organization_timezone: string
            }
            Returns: string
          }
      change_incident_step: {
        Args: {
          expected_revision: number
          operation: string
          org: string
          payload: Json
          step: string
          ticket: string
        }
        Returns: number
      }
      claim_automation_events: {
        Args: { batch_size?: number; lease_seconds?: number }
        Returns: {
          attempts: number
          delivery_id: string
          event: Json
          lease_expires_at: string
          lease_token: string
        }[]
      }
      claim_domain_events: {
        Args: {
          batch_size?: number
          consumer_name?: string
          lease_seconds?: number
        }
        Returns: {
          attempts: number
          delivery_id: string
          event: Json
          lease_expires_at: string
          lease_token: string
        }[]
      }
      claim_notification_emails: {
        Args: { batch_size?: number }
        Returns: {
          approved_body: string
          conversation_id: string
          email_kind: string
          event_created_at: string
          incident_bulletin_id: string
          lease_token: string
          next_update_at: string
          notification_id: string
          previous_status: Database["public"]["Enums"]["ticket_status"]
          recipient_email: string
          reopen_reason: string
          reply_author: string
          reply_created_at: string
          reply_preview: string
          status_changed_by: string
          ticket_id: string
          ticket_owner: string
          ticket_priority: Database["public"]["Enums"]["ticket_priority"]
          ticket_status: Database["public"]["Enums"]["ticket_status"]
          title: string
        }[]
      }
      claim_report_deliveries: {
        Args: { batch_size?: number; lease_seconds?: number }
        Returns: {
          attempts: number
          definition: Json
          delivery_id: string
          format: string
          lease_token: string
          organization_id: string
          recipient_email: string
          report_id: string
          report_name: string
          scheduled_for: string
        }[]
      }
      complete_member_invitation: {
        Args: {
          actor: string
          invited_user: string
          org: string
          token: string
        }
        Returns: undefined
      }
      convert_chat_to_ticket: {
        Args: { conversation_id: string }
        Returns: string
      }
      create_automation_rule: {
        Args: { definition: Json; target_organization_id: string }
        Returns: {
          actions: Json | null
          archived_at: string | null
          conditions: Json | null
          created_at: string
          created_by: string
          definition: Json
          description: string | null
          enabled: boolean
          enabled_at: string | null
          id: string
          name: string | null
          organization_id: string
          trigger_configuration: Json | null
          trigger_type: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "automation_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_equipment_ticket: {
        Args: {
          asset: string
          body: string
          category?: string
          org: string
          subject: string
        }
        Returns: string
      }
      custom_report: {
        Args: { report_config: Json; target_organization_id: string }
        Returns: Json
      }
      discover_automation_rules: {
        Args: {
          after_created_at?: string
          after_rule_id?: string
          batch_size?: number
          delivery_id: string
          token: string
        }
        Returns: {
          rule: Json
          rule_id: string
          sort_created_at: string
        }[]
      }
      discover_temporal_automation: {
        Args: { rule_limit?: number; ticket_limit?: number }
        Returns: Json
      }
      duplicate_automation_rule: {
        Args: {
          expected_version: number
          name: string
          rule_id: string
          target_organization_id: string
        }
        Returns: {
          actions: Json | null
          archived_at: string | null
          conditions: Json | null
          created_at: string
          created_by: string
          definition: Json
          description: string | null
          enabled: boolean
          enabled_at: string | null
          id: string
          name: string | null
          organization_id: string
          trigger_configuration: Json | null
          trigger_type: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "automation_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      edit_chat_message: {
        Args: {
          conversation: string
          expected_revision: number
          message: string
          new_body: string
          org: string
        }
        Returns: {
          author_id: string
          body: string
          conversation_id: string
          created_at: string
          edited_at: string | null
          id: string
          kind: Database["public"]["Enums"]["chat_message_kind"]
          organization_id: string
          revision: number
        }[]
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_incident_escalations: { Args: never; Returns: number }
      enqueue_incident_update_reminders: { Args: never; Returns: number }
      enqueue_scheduled_report_deliveries: { Args: never; Returns: number }
      enqueue_sla_notifications: { Args: never; Returns: number }
      execute_automation_ticket_step: {
        Args: { command: Json; execution_id: string; token: string }
        Returns: {
          action_id: string
          action_type: string
          attempts: number
          completed_at: string | null
          duration_ms: number | null
          error_code: string | null
          execution_id: string
          id: string
          idempotency_key: string
          organization_id: string
          position: number
          result: Json | null
          started_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "automation_execution_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_automation_run: {
        Args: { metrics: Json; outcome: string; run_id: string }
        Returns: boolean
      }
      finish_domain_event_delivery: {
        Args: {
          delivery_id: string
          failure_code?: string
          outcome: string
          token: string
        }
        Returns: boolean
      }
      finish_notification_email: {
        Args: {
          failure?: string
          provider_message_id?: string
          target_id: string
          token: string
        }
        Returns: boolean
      }
      finish_report_delivery: {
        Args: {
          failure_code: string
          provider_id: string
          report_summary: Json
          snapshot: string
          target_id: string
          token: string
        }
        Returns: boolean
      }
      get_automation_execution: {
        Args: { execution_id: string; token: string }
        Returns: {
          actions_attempted: number
          causation_id: string | null
          completed_at: string | null
          conditions: Json
          correlation_id: string
          delivery_id: string
          depth: number
          duration_ms: number | null
          entity_id: string
          entity_type: string
          error_code: string | null
          event_id: string
          expected_entity_revision: number
          id: string
          organization_id: string
          processing_generation: number
          root_event_id: string
          rule_id: string
          rule_name: string
          rule_version: number
          started_at: string
          status: string
          trigger_type: string
        }
        SetofOptions: {
          from: "*"
          to: "automation_executions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      incident_delivery_summary: {
        Args: { bulletins: string[]; org: string; ticket: string }
        Returns: {
          bulletin_id: string
          failed: number
          pending: number
          sent: number
          skipped: number
          total: number
        }[]
      }
      inventory_choices: {
        Args: {
          active_only?: boolean
          after_id?: string
          after_label?: string
          org: string
          parent?: string
          query?: string
          resource: string
          selected?: string
        }
        Returns: {
          active: boolean
          id: string
          label: string
          parent_id: string
        }[]
      }
      inventory_command: {
        Args: { command: string; org: string; payload: Json; token: string }
        Returns: string
      }
      link_chat_to_ticket: {
        Args: { conversation_id: string; target_ticket_id: string }
        Returns: string
      }
      lookup_choices: {
        Args: {
          active_only?: boolean
          after_id?: string
          after_label?: string
          org: string
          parent?: string
          query?: string
          resource: string
          selected?: string
        }
        Returns: {
          active: boolean
          id: string
          label: string
          parent_id: string
        }[]
      }
      manage_customer:
        | {
            Args: {
              admin_email?: string
              admin_name?: string
              customer_name: string
              customer_slug?: string
              target: string
            }
            Returns: string
          }
        | {
            Args: {
              admin_email: string
              admin_name: string
              customer_name: string
              customer_slug: string
              organization_timezone: string
              target: string
            }
            Returns: string
          }
      manage_incident_communication: {
        Args: {
          expected_revision: number
          operation: string
          org: string
          payload: Json
          target: string
          ticket: string
        }
        Returns: number
      }
      manage_incident_control: {
        Args: {
          expected_revision: number
          operation: string
          org: string
          payload: Json
          target: string
          ticket: string
        }
        Returns: number
      }
      manage_workflow_template: {
        Args: {
          expected_revision: number
          operation: string
          org: string
          payload: Json
          target: string
        }
        Returns: number
      }
      operational_report: {
        Args: { target_organization_id: string }
        Returns: Json
      }
      platform_access: { Args: never; Returns: string }
      platform_overview: {
        Args: { days?: number; page_number?: number; search_text?: string }
        Returns: Json
      }
      prepare_member_invitation: {
        Args: {
          actor: string
          display_name: string
          email: string
          member_role: Database["public"]["Enums"]["app_role"]
          org: string
          token: string
        }
        Returns: Json
      }
      product_usage_summary: {
        Args: { days?: number }
        Returns: {
          count: number
          day: string
          event: string
          role: Database["public"]["Enums"]["app_role"]
          surface: string
        }[]
      }
      rate_article: {
        Args: {
          is_helpful: boolean
          target_article_id: string
          target_organization_id: string
        }
        Returns: undefined
      }
      read_automation_admin: {
        Args: {
          kind: string
          org: string
          page_number?: number
          query?: string
          resource?: string
          selected?: string[]
          state?: string
          target?: string
          trigger_type?: string
        }
        Returns: Json
      }
      read_automation_dry_run: {
        Args: {
          draft?: Json
          event_id?: string
          rule_id?: string
          rule_version?: number
          target_organization_id: string
          ticket_id: string
        }
        Returns: Json
      }
      read_automation_operations: { Args: { org: string }; Returns: Json }
      read_automation_operations_history: {
        Args: {
          before_at?: string
          before_id?: string
          org: string
          query?: string
          result_filter?: string
          since_at?: string
          ticket_number?: number
          trigger_type?: string
          until_at?: string
        }
        Returns: Json
      }
      record_article_view: {
        Args: { target_article_id: string; target_organization_id: string }
        Returns: undefined
      }
      record_product_usage: {
        Args: {
          event_name: string
          event_surface: string
          event_token?: string
          org?: string
          target_id?: string
        }
        Returns: undefined
      }
      register_invited_member: {
        Args: {
          invited_by: string
          invited_email: string
          invited_name: string
          invited_role: Database["public"]["Enums"]["app_role"]
          invited_user_id: string
          target_organization_id: string
        }
        Returns: undefined
      }
      reopen_ticket: {
        Args: {
          expected_revision: number
          explanation: string
          target: string
          token: string
        }
        Returns: number
      }
      report_delivery_history: {
        Args: { target_report_id: string }
        Returns: {
          attempts: number
          completed_at: string
          error_code: string
          format: string
          id: string
          recipient_email: string
          scheduled_for: string
          snapshot_at: string
          status: string
        }[]
      }
      save_ticket_incident: {
        Args: {
          expected_revision: number
          org: string
          payload: Json
          target: string
        }
        Returns: number
      }
      search_assets: {
        Args: { search_text: string; target_organization_id: string }
        Returns: {
          assigned_user_id: string | null
          created_at: string
          id: string
          kind: string
          location_id: string | null
          model: string | null
          name: string
          organization_id: string
          purchased_on: string | null
          revision: number
          search_document: unknown
          serial_number: string | null
          status: string
          tag: string
          updated_at: string
          warranty_until: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "assets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_audit_events: {
        Args: { search_text: string; target_organization_id: string }
        Returns: {
          action: string
          actor_id: string | null
          actor_name: string
          changes: Json
          created_at: string
          entity_id: string
          entity_label: string
          entity_type: string
          id: number
          organization_id: string
          search_text: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_knowledge_articles: {
        Args: { search_text: string; target_organization_id: string }
        Returns: {
          audience: string
          author_id: string | null
          category: string
          content: Json
          created_at: string
          id: string
          organization_id: string
          related_article_ids: string[]
          revision: number
          search_body: string
          status: string
          summary: string
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_articles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_members: {
        Args: { search_text: string; target_organization_id: string }
        Returns: {
          activated_at: string
          created_at: string
          deactivated_at: string | null
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "organization_memberships"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_tickets: {
        Args: { search_text: string; target_organization_id: string }
        Returns: {
          assigned_technician_id: string | null
          category_id: string | null
          closed_at: string | null
          created_at: string
          description: string
          due_at: string | null
          first_response_at: string | null
          id: string
          incident_revision: number
          location_id: string | null
          organization_id: string
          priority: Database["public"]["Enums"]["ticket_priority"]
          reported_impact: string | null
          request_kind: string
          requester_id: string
          resolution_sla_due_at: string
          resolved_at: string | null
          response_sla_due_at: string
          revision: number
          routing_mode: string
          sla_next_due_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subcategory_id: string | null
          team_id: string | null
          ticket_number: number
          ticket_type: string
          title: string
          unassigned_episode_id: string | null
          unassigned_since: string | null
          updated_at: string
          waiting_on_user_episode_id: string | null
          waiting_on_user_since: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_automation_rule_enabled: {
        Args: {
          enabled: boolean
          expected_version: number
          rule_id: string
          target_organization_id: string
        }
        Returns: {
          actions: Json | null
          archived_at: string | null
          conditions: Json | null
          created_at: string
          created_by: string
          definition: Json
          description: string | null
          enabled: boolean
          enabled_at: string | null
          id: string
          name: string | null
          organization_id: string
          trigger_configuration: Json | null
          trigger_type: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "automation_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_automation_run: { Args: { kind: string }; Returns: string }
      start_support_chat: {
        Args: {
          chat_topic: string
          first_message: string
          target_organization_id: string
        }
        Returns: string
      }
      submit_incident_ticket: {
        Args: { org: string; payload: Json; token: string }
        Returns: string
      }
      submit_support_request: {
        Args: { kind: string; org: string; payload: Json; token: string }
        Returns: string
      }
      update_automation_rule: {
        Args: {
          definition: Json
          expected_version: number
          rule_id: string
          target_organization_id: string
        }
        Returns: {
          actions: Json | null
          archived_at: string | null
          conditions: Json | null
          created_at: string
          created_by: string
          definition: Json
          description: string | null
          enabled: boolean
          enabled_at: string | null
          id: string
          name: string | null
          organization_id: string
          trigger_configuration: Json | null
          trigger_type: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "automation_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "end_user" | "technician" | "administrator"
      chat_message_kind: "message" | "internal_note"
      chat_status: "open" | "closed"
      membership_status: "active" | "inactive"
      notification_kind:
        | "ticket_assigned"
        | "ticket_response"
        | "new_chat"
        | "ticket_reassigned"
        | "sla_approaching"
        | "ticket_resolved"
        | "ticket_reopened"
        | "user_replied"
        | "chat_response"
        | "automation_update"
        | "incident_update"
        | "incident_update_due"
        | "incident_escalation"
        | "incident_approval"
        | "incident_step_assigned"
        | "ticket_created"
      ticket_message_kind: "reply" | "internal_note"
      ticket_priority: "low" | "normal" | "high" | "critical"
      ticket_status:
        | "new"
        | "open"
        | "in_progress"
        | "waiting_on_user"
        | "on_hold"
        | "resolved"
        | "closed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["end_user", "technician", "administrator"],
      chat_message_kind: ["message", "internal_note"],
      chat_status: ["open", "closed"],
      membership_status: ["active", "inactive"],
      notification_kind: [
        "ticket_assigned",
        "ticket_response",
        "new_chat",
        "ticket_reassigned",
        "sla_approaching",
        "ticket_resolved",
        "ticket_reopened",
        "user_replied",
        "chat_response",
        "automation_update",
        "incident_update",
        "incident_update_due",
        "incident_escalation",
        "incident_approval",
        "incident_step_assigned",
        "ticket_created",
      ],
      ticket_message_kind: ["reply", "internal_note"],
      ticket_priority: ["low", "normal", "high", "critical"],
      ticket_status: [
        "new",
        "open",
        "in_progress",
        "waiting_on_user",
        "on_hold",
        "resolved",
        "closed",
      ],
    },
  },
} as const
