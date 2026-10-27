import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';

import { parseDeadline } from './deadlines';

export const incidentSeverities = {
  critical: {
    label: 'Critical',
    description: 'Widespread outage of essential operations',
    tone: 'danger',
  },
  major: {
    label: 'Major',
    description: 'Significant disruption affecting multiple people or teams',
    tone: 'warning',
  },
  moderate: {
    label: 'Moderate',
    description: 'Partial disruption with a workaround',
    tone: 'info',
  },
  minor: { label: 'Minor', description: 'Limited business impact', tone: 'neutral' },
} as const;
export type IncidentSeverity = keyof typeof incidentSeverities;
export type Incident = {
  ticket_id: string;
  organization_id: string;
  severity: IncidentSeverity;
  business_impact: string;
  owner_id: string;
  affected_services: string[];
  affected_locations: string[];
  created_at: string;
  updated_at: string;
  disruption_started_at?: string | null;
  service_restored_at?: string | null;
};
export type IncidentInput = Pick<
  Incident,
  | 'severity'
  | 'business_impact'
  | 'owner_id'
  | 'affected_services'
  | 'affected_locations'
  | 'disruption_started_at'
  | 'service_restored_at'
>;
export function parseIncident(
  form: FormData,
): { data: IncidentInput; error?: never } | { error: string; data?: never } {
  const severity = formString(form, 'incidentSeverity', '') as IncidentSeverity;
  const business_impact = formString(form, 'businessImpact', '').trim();
  const owner_id = formString(form, 'incidentOwnerId', '');
  const names = (key: string) => [
    ...new Set(
      formString(form, key, '')
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const affected_services = names('affectedServices'),
    affected_locations = names('affectedLocations');
  if (
    !Object.hasOwn(incidentSeverities, severity) ||
    business_impact.length < 3 ||
    business_impact.length > 4000 ||
    !isUuid(owner_id)
  )
    return {
      error:
        'Choose an incident severity and owner, and describe the business impact (3–4,000 characters).',
    };
  if (
    [affected_services, affected_locations].some(
      (values) => values.length > 30 || values.some((value) => value.length > 120),
    )
  )
    return {
      error:
        'Enter up to 30 services and 30 locations, one per line, with at most 120 characters per name.',
    };
  const data: IncidentInput = {
    severity,
    business_impact,
    owner_id,
    affected_services,
    affected_locations,
  };
  for (const [prefix, key] of [
    ['disruption', 'disruption_started_at'],
    ['restored', 'service_restored_at'],
  ] as const) {
    if (!form.has(`${prefix}At`)) continue;
    const value = parseDeadline(
      formString(form, `${prefix}At`, ''),
      formString(form, `${prefix}Timezone`, ''),
      formString(form, `${prefix}Occurrence`, ''),
    );
    if (value === undefined || (value && Date.parse(value) > Date.now()))
      return {
        error:
          'Choose valid incident times in the past, including an occurrence when the clock changes.',
      };
    data[key] = value;
  }
  if (
    data.service_restored_at &&
    (!data.disruption_started_at ||
      Date.parse(data.service_restored_at) < Date.parse(data.disruption_started_at))
  )
    return { error: 'Service restored must be on or after disruption started.' };
  return { data };
}
