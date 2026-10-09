'use client';
import { useTimezone } from '@/features/timezones/provider';
import { auditValue } from './presentation';
import type { Json } from '@/types/database';
export function AuditValue({ field, value }: { field: string; value: Json | undefined }) {
  return auditValue(field, value, useTimezone());
}
