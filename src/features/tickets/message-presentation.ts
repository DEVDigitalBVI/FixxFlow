import type { TicketMessageKind } from "@/types/database";

export const messageKinds = {
  reply: { label: "Public reply", audience: "Visible to the requester and IT staff.", action: "Send public reply" },
  internal_note: { label: "Internal note", audience: "IT staff only · Hidden from the requester.", action: "Add internal note" },
} satisfies Record<TicketMessageKind, { label: string; audience: string; action: string }>;
