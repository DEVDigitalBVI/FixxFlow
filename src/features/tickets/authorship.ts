import type { Json } from '@/types/database';

export type MessageAuthor = { author_id: string | null; author_type?: string; automation_name?: string | null };
export function messageAuthorName(message: MessageAuthor, names: ReadonlyMap<string, string>, viewerId: string): string {
  if (message.author_type === 'automation') return `Automation: ${message.automation_name ?? 'Automation'}`;
  if (message.author_id === viewerId) return 'You';
  return message.author_id ? names.get(message.author_id) ?? 'Team member' : 'System';
}
export function activityAuthorName(actorId: string | null, details: Json | undefined, names: ReadonlyMap<string, string>): string {
  if (!actorId && details && typeof details === 'object' && !Array.isArray(details) && typeof details.automationName === 'string') return `Automation: ${details.automationName}`;
  return actorId ? names.get(actorId) ?? 'Team member' : 'System';
}
