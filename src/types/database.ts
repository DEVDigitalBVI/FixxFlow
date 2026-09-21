export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type AppRole = "end_user" | "technician" | "administrator";
export type MembershipStatus = "active" | "inactive";

type Organization = { id: string; name: string; slug: string; logo_path: string | null; created_at: string; updated_at: string };
type Membership = { organization_id: string; user_id: string; role: AppRole; status: MembershipStatus; activated_at: string; deactivated_at: string | null; created_at: string; updated_at: string };
type Department = { id: string; organization_id: string; name: string; description: string | null; is_active: boolean; created_at: string; updated_at: string };
type Location = { id: string; organization_id: string; name: string; address_line_1: string | null; address_line_2: string | null; city: string | null; region: string | null; postal_code: string | null; country_code: string | null; timezone: string; is_active: boolean; created_at: string; updated_at: string };
type Profile = { organization_id: string; user_id: string; department_id: string | null; location_id: string | null; display_name: string; email: string | null; job_title: string | null; phone: string | null; avatar_path: string | null; created_at: string; updated_at: string };

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
    };
    Views: Record<string, never>;
    Functions: {
      bootstrap_organization: {
        Args: { organization_name: string; organization_slug: string; administrator_name: string; administrator_user_id: string };
        Returns: string;
      };
    };
    Enums: { app_role: AppRole; membership_status: MembershipStatus };
    CompositeTypes: Record<string, never>;
  };
};
