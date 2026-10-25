export const knowledgeAudiences = {
  employees: { label: 'Employee-facing', description: 'Published guides are available to employees and IT staff.' },
  it_only: { label: 'IT only', description: 'Available only to technicians and administrators in this workspace.' },
} as const;
export type KnowledgeAudience = keyof typeof knowledgeAudiences;
export const isKnowledgeAudience = (value: unknown): value is KnowledgeAudience => typeof value === 'string' && Object.hasOwn(knowledgeAudiences, value);
