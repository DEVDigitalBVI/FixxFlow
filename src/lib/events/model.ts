/** Transport-independent data contracts. No persistence or publishing in Stage 1. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type EntitySnapshot = Readonly<Record<string, JsonValue>>;

export type DomainEvent = {
  readonly id: string;
  readonly schemaVersion: number;
  readonly type: string;
  readonly organizationId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityVersion: number;
  readonly actorType: 'member' | 'automation' | 'system';
  readonly actorId: string | null;
  readonly timestamp: string;
  readonly before: EntitySnapshot | null;
  readonly after: EntitySnapshot;
  readonly changedFields: readonly string[];
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly rootEventId: string;
  readonly depth: number;
  readonly automationExecutionId?: string;
};
