import type { AppRole } from "@/types/database";

export const rolePresentation: Record<AppRole, { label: string; description: string }> = {
  end_user: { label: "End User", description: "Requests and receives IT support" },
  technician: { label: "Technician", description: "Works tickets and support conversations" },
  administrator: { label: "Administrator", description: "Configures and manages the system" },
};
