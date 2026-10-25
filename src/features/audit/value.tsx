'use client';

import { useTimezone } from '@/features/timezones/provider';
import type { Json } from '@/types/database';

import { auditValue } from './presentation';

export function AuditValue({ field, value }: { field: string; value: Json | undefined }) {
  return auditValue(field, value, useTimezone());
}
