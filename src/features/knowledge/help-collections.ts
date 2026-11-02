export const helpTopics = {
  'getting-started': 'Getting started',
  requests: 'Tickets & chat',
  equipment: 'Equipment & supplies',
  account: 'Your account',
  administration: 'IT administration',
  automations: 'Automations',
} as const;
export type HelpTopic = keyof typeof helpTopics;
export type HelpMetadata = {
  help_collection?: 'knowledge' | 'fixxflow';
  help_topic?: HelpTopic | null;
  help_format?: 'guide' | 'faq';
};
export function isHelpTopic(value: unknown): value is HelpTopic {
  return typeof value === 'string' && Object.hasOwn(helpTopics, value);
}
export function helpArticleHref(article: { id: string; help_collection?: string }) {
  return `${article.help_collection === 'fixxflow' ? '/app/faq' : '/app/help'}/${article.id}`;
}
