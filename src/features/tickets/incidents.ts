export const incidentSeverities = {
  critical: { label: 'Critical', description: 'Widespread outage of essential operations', tone: 'danger' },
  major: { label: 'Major', description: 'Significant disruption affecting multiple people or teams', tone: 'warning' },
  moderate: { label: 'Moderate', description: 'Partial disruption with a workaround', tone: 'info' },
  minor: { label: 'Minor', description: 'Limited business impact', tone: 'neutral' },
} as const;
export type IncidentSeverity = keyof typeof incidentSeverities;
export type Incident = {
  ticket_id: string; organization_id: string; severity: IncidentSeverity; business_impact: string;
  owner_id: string; affected_services: string[]; affected_locations: string[]; created_at: string; updated_at: string;
};
export type IncidentInput = Pick<Incident, 'severity' | 'business_impact' | 'owner_id' | 'affected_services' | 'affected_locations'>;
export function parseIncident(form: FormData): { data: IncidentInput; error?: never } | { error: string; data?: never } {
  const severity = String(form.get('incidentSeverity') ?? '') as IncidentSeverity;
  const business_impact = String(form.get('businessImpact') ?? '').trim();
  const owner_id = String(form.get('incidentOwnerId') ?? '');
  const names = (key: string) => [...new Set(String(form.get(key) ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
  const affected_services = names('affectedServices'), affected_locations = names('affectedLocations');
  if (!Object.hasOwn(incidentSeverities,severity) || business_impact.length < 3 || business_impact.length > 4000 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner_id)) return { error: 'Choose an incident severity and owner, and describe the business impact (3–4,000 characters).' };
  if ([affected_services,affected_locations].some(values => values.length > 30 || values.some(value => value.length > 120))) return { error: 'Enter up to 30 services and 30 locations, one per line, with at most 120 characters per name.' };
  return { data: { severity,business_impact,owner_id,affected_services,affected_locations } };
}
