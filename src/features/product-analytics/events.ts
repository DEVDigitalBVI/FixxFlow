export const pageEvents = ['ticket_viewed','knowledge_article_viewed','search_performed'] as const;
export type PageEvent = typeof pageEvents[number];
export type UsageSurface = 'tickets'|'knowledge';
export function allowedPageEvent(event:string,surface:string) {
  return (event==='ticket_viewed'&&surface==='tickets') || (event==='knowledge_article_viewed'&&surface==='knowledge') || (event==='search_performed'&&(surface==='tickets'||surface==='knowledge'));
}
