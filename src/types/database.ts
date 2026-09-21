export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type AppRole = "end_user" | "technician" | "administrator";
export type MembershipStatus = "active" | "inactive";
export type TicketStatus = "new" | "open" | "in_progress" | "waiting_on_user" | "on_hold" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "critical";
export type TicketMessageKind = "reply" | "internal_note";
export type ChatStatus = "open" | "closed";
export type ChatMessageKind = "message" | "internal_note";

type Organization = { id: string; name: string; slug: string; logo_path: string | null; created_at: string; updated_at: string };
type Membership = { organization_id: string; user_id: string; role: AppRole; status: MembershipStatus; activated_at: string; deactivated_at: string | null; created_at: string; updated_at: string };
type Department = { id: string; organization_id: string; name: string; description: string | null; is_active: boolean; created_at: string; updated_at: string };
type Location = { id: string; organization_id: string; name: string; address_line_1: string | null; address_line_2: string | null; city: string | null; region: string | null; postal_code: string | null; country_code: string | null; timezone: string; is_active: boolean; created_at: string; updated_at: string };
type Profile = { organization_id: string; user_id: string; department_id: string | null; location_id: string | null; display_name: string; email: string | null; job_title: string | null; phone: string | null; avatar_path: string | null; created_at: string; updated_at: string };
type Team = { id: string; organization_id: string; name: string; description: string | null; is_active: boolean; created_at: string; updated_at: string };
type TicketCategory = { id: string; organization_id: string; name: string; is_active: boolean; created_at: string; updated_at: string };
type TicketSubcategory = { id: string; organization_id: string; category_id: string; name: string; is_active: boolean; created_at: string; updated_at: string };
type Ticket = { id: string; organization_id: string; ticket_number: number; title: string; description: string; requester_id: string; assigned_technician_id: string | null; team_id: string | null; category_id: string | null; subcategory_id: string | null; priority: TicketPriority; status: TicketStatus; location_id: string | null; first_response_at: string | null; due_at: string | null; resolved_at: string | null; closed_at: string | null; created_at: string; updated_at: string };
type TicketMessage = { id: string; organization_id: string; ticket_id: string; author_id: string; kind: TicketMessageKind; body: string; created_at: string; updated_at: string };
type TicketAttachment = { id: string; organization_id: string; ticket_id: string; uploaded_by: string; storage_path: string; file_name: string; content_type: string; size_bytes: number; created_at: string };
type TicketActivity = { id: number; organization_id: string; ticket_id: string; actor_id: string | null; action: string; details: Json; created_at: string };
type ChatConversation = { id: string; organization_id: string; requester_id: string; assigned_technician_id: string | null; topic: string; status: ChatStatus; ticket_id: string | null; created_at: string; updated_at: string; closed_at: string | null };
type ChatMessage = { id: string; organization_id: string; conversation_id: string; author_id: string; kind: ChatMessageKind; body: string; created_at: string };
type ChatAttachment = { id: string; organization_id: string; conversation_id: string; uploaded_by: string; storage_path: string; file_name: string; content_type: string; size_bytes: number; created_at: string };

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      organizations: Table<Organization, Pick<Organization, "name" | "slug"> & Partial<Organization>>;
      organization_memberships: Table<Membership, Pick<Membership, "organization_id" | "user_id"> & Partial<Membership>>;
      departments: Table<Department, Pick<Department, "organization_id" | "name"> & Partial<Department>>;
      locations: Table<Location, Pick<Location, "organization_id" | "name"> & Partial<Location>>;
      profiles: Table<Profile, Pick<Profile, "organization_id" | "user_id" | "display_name"> & Partial<Profile>>;
      teams: Table<Team, Pick<Team, "organization_id" | "name"> & Partial<Team>>;
      ticket_categories: Table<TicketCategory, Pick<TicketCategory, "organization_id" | "name"> & Partial<TicketCategory>>;
      ticket_subcategories: Table<TicketSubcategory, Pick<TicketSubcategory, "organization_id" | "category_id" | "name"> & Partial<TicketSubcategory>>;
      tickets: Table<Ticket, Pick<Ticket, "organization_id" | "title" | "description" | "requester_id"> & Partial<Ticket>>;
      ticket_messages: Table<TicketMessage, Pick<TicketMessage, "organization_id" | "ticket_id" | "author_id" | "body"> & Partial<TicketMessage>>;
      ticket_attachments: Table<TicketAttachment, Pick<TicketAttachment, "organization_id" | "ticket_id" | "uploaded_by" | "storage_path" | "file_name" | "content_type" | "size_bytes"> & Partial<TicketAttachment>>;
      ticket_activity: Table<TicketActivity>;
      chat_conversations: Table<ChatConversation, Pick<ChatConversation, "organization_id" | "requester_id" | "topic"> & Partial<ChatConversation>>;
      chat_messages: Table<ChatMessage, Pick<ChatMessage, "organization_id" | "conversation_id" | "author_id" | "body"> & Partial<ChatMessage>>;
      chat_attachments: Table<ChatAttachment, Pick<ChatAttachment, "organization_id" | "conversation_id" | "uploaded_by" | "storage_path" | "file_name" | "content_type" | "size_bytes"> & Partial<ChatAttachment>>;
    };
    Views: Record<string, never>;
    Functions: {
      bootstrap_organization: {
        Args: { organization_name: string; organization_slug: string; administrator_name: string; administrator_user_id: string };
        Returns: string;
      };
      start_support_chat: { Args: { target_organization_id: string; chat_topic: string; first_message: string }; Returns: string };
      convert_chat_to_ticket: { Args: { conversation_id: string }; Returns: string };
      link_chat_to_ticket: { Args: { conversation_id: string; target_ticket_id: string }; Returns: string };
    };
    Enums: { app_role: AppRole; membership_status: MembershipStatus; ticket_status: TicketStatus; ticket_priority: TicketPriority; ticket_message_kind: TicketMessageKind; chat_status: ChatStatus; chat_message_kind: ChatMessageKind };
    CompositeTypes: Record<string, never>;
  };
};
