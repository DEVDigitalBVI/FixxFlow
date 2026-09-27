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
    PostgrestVersion: "14.5"
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
          id: string
          kind: Database["public"]["Enums"]["chat_message_kind"]
          organization_id: string
        }
        Insert: {
          author_id: string
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["chat_message_kind"]
          organization_id: string
        }
        Update: {
          author_id?: string
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["chat_message_kind"]
          organization_id?: string
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
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name?: string
          slug?: string
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
      ticket_messages: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["ticket_message_kind"]
          organization_id: string
          ticket_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["ticket_message_kind"]
          organization_id: string
          ticket_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
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
          location_id: string | null
          organization_id: string
          priority: Database["public"]["Enums"]["ticket_priority"]
          requester_id: string
          resolution_sla_due_at: string
          resolved_at: string | null
          response_sla_due_at: string
          routing_mode: string
          sla_next_due_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subcategory_id: string | null
          team_id: string | null
          ticket_number: number
          title: string
          updated_at: string
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
          location_id?: string | null
          organization_id: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          requester_id: string
          resolution_sla_due_at: string
          resolved_at?: string | null
          response_sla_due_at: string
          routing_mode?: string
          sla_next_due_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subcategory_id?: string | null
          team_id?: string | null
          ticket_number: number
          title: string
          updated_at?: string
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
          location_id?: string | null
          organization_id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          requester_id?: string
          resolution_sla_due_at?: string
          resolved_at?: string | null
          response_sla_due_at?: string
          routing_mode?: string
          sla_next_due_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subcategory_id?: string | null
          team_id?: string | null
          ticket_number?: number
          title?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_organization: {
        Args: {
          administrator_name: string
          administrator_user_id: string
          organization_name: string
          organization_slug: string
        }
        Returns: string
      }
      claim_notification_emails: {
        Args: { batch_size?: number }
        Returns: {
          conversation_id: string
          lease_token: string
          notification_id: string
          recipient_email: string
          ticket_id: string
          title: string
        }[]
      }
      convert_chat_to_ticket: {
        Args: { conversation_id: string }
        Returns: string
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
      enqueue_sla_notifications: { Args: never; Returns: number }
      finish_notification_email: {
        Args: {
          failure?: string
          provider_message_id?: string
          target_id: string
          token: string
        }
        Returns: boolean
      }
      link_chat_to_ticket: {
        Args: { conversation_id: string; target_ticket_id: string }
        Returns: string
      }
      manage_customer: {
        Args: {
          admin_email?: string
          admin_name?: string
          customer_name: string
          customer_slug?: string
          target: string
        }
        Returns: string
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
          location_id: string | null
          organization_id: string
          priority: Database["public"]["Enums"]["ticket_priority"]
          requester_id: string
          resolution_sla_due_at: string
          resolved_at: string | null
          response_sla_due_at: string
          routing_mode: string
          sla_next_due_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subcategory_id: string | null
          team_id: string | null
          ticket_number: number
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      start_support_chat: {
        Args: {
          chat_topic: string
          first_message: string
          target_organization_id: string
        }
        Returns: string
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
