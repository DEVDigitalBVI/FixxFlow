export type Customer={id:string;name:string;slug:string;created_at:string;members:number};
export type Usage={event:string;role:string;surface:string;count:number};
export type PlatformData={organizations:Customer[];organizationCount:number;matchingCount:number;usage:Usage[];audit:{id:number;actor_id:string;organization_id:string|null;action:string;details:Record<string,string|null>;created_at:string}[]};
export const eventLabels:Record<string,string>={login:'Completed logins',ticket_created:'Tickets created',ticket_viewed:'Ticket views',ticket_updated:'Ticket updates',ticket_resolved:'Tickets resolved',ticket_reopened:'Tickets reopened',chat_started:'Chats started',chat_message_sent:'Chat messages sent',chat_converted_to_ticket:'Chats converted to tickets',search_performed:'Searches performed',knowledge_article_viewed:'Help article views',asset_viewed:'Asset views'};
export function usageTotals(rows: Usage[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.event, (totals.get(row.event) ?? 0) + Number(row.count));
  }
  return Object.entries(eventLabels).map(([event, label]) => ({
    label,
    value: totals.get(event) ?? 0,
  }));
}
