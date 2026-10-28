export type SuggestedArticle = {
  id: string;
  organization_id?: string | null;
  title: string;
  summary: string;
  category: string;
  audience?: import('./audience').KnowledgeAudience;
};
