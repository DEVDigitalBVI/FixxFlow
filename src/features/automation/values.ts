import type { JsonValue } from '@/lib/events/model';
import type { ConfigurationSchema, ValueSchema } from './registries';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export const isIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(value);
export const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
export function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && Number.isFinite(Date.parse(value));
}

/** Bound work before parsing; reject non-JSON, accessors, cycles and prototype keys. */
export function isBoundedJson(value: unknown): value is JsonValue {
  let nodes = 0;
  let characters = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): boolean {
    if (++nodes > 10000 || depth > 12) return false;
    if (typeof item === 'string') { characters += item.length; return characters <= 100000; }
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (!Array.isArray(item) && !isRecord(item)) return false;
    if (ancestors.has(item) || Object.getOwnPropertySymbols(item).length) return false;
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item) && (item.length > 1000 || Object.keys(descriptors).length !== item.length + 1)) return false;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === 'length') continue;
      characters += key.length;
      if (characters > 100000 || ['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in descriptor) || !descriptor.enumerable || !visit(descriptor.value, depth + 1)) return false;
    }
    ancestors.delete(item);
    return true;
  }
  return visit(value, 0);
}

export function matchesValue(value: unknown, schema: ValueSchema): boolean {
  switch (schema.kind) {
    case 'reference': return isUuid(value);
    case 'enum': return typeof value === 'string' && schema.values.includes(value);
    case 'string': return typeof value === 'string' && value.trim().length >= (schema.minLength ?? 0) && value.length <= schema.maxLength;
    case 'number': return typeof value === 'number' && Number.isFinite(value) && (!schema.integer || Number.isSafeInteger(value)) && (schema.min === undefined || value >= schema.min) && (schema.max === undefined || value <= schema.max);
    case 'boolean': return typeof value === 'boolean';
    case 'string_set': return Array.isArray(value) && value.length <= schema.maxItems && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= schema.itemMaxLength) && new Set(value).size === value.length;
  }
}

export function matchesConfiguration(value: unknown, schema: ConfigurationSchema): value is Record<string, JsonValue> {
  return isRecord(value) && hasOnly(value, Object.keys(schema)) && Object.entries(schema).every(([key, property]) =>
    Object.hasOwn(value, key) ? matchesValue(value[key], property.value) : property.optional === true);
}

/** Call only after the JSON guard. Detaches returned definitions/plans from input. */
export function copyJson<T>(value: T): T { return structuredClone(value); }
