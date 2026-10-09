import type { Json } from './database.generated';
export type InventoryItem = { id: string; organization_id: string; name: string; kind: 'equipment' | 'consumable'; department_id: string; location_id: string; department_name: string; location_name: string; stock: number; reserved: number; created_at: string };
export type InventoryState = 'pending' | 'needs_information' | 'approved' | 'declined' | 'cancelled' | 'issued';
export type InventoryRequest = { id: string; organization_id: string; ticket_id: string; item_id: string; requester_id: string; department_id: string; quantity: number; state: InventoryState; recipient_id: string | null; destination: string; printer_id: string | null; context: Json; reason: string; decision_reason: string | null; issued_by: string | null; issued_at: string | null; created_at: string };
export type InventoryEquipment = { organization_id: string; asset_id: string; item_id: string; request_id: string | null; state: 'stored' | 'reserved' | 'issued' | 'removed'; asset_context: Json };
export type InventoryMovement = { id: string; organization_id: string; item_id: string; request_id: string | null; kind: 'received' | 'corrected' | 'reserved' | 'released' | 'issued'; quantity: number; actor_id: string; actor_name: string; note: string; context: Json; created_at: string };
type ReadTable<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };
export type InventoryTables = {
 inventory_managers: ReadTable<{ organization_id: string; user_id: string }>;
 inventory_requesters: ReadTable<{ organization_id: string; user_id: string; department_id: string }>;
 inventory_items: ReadTable<InventoryItem>;
 inventory_requests: ReadTable<InventoryRequest>;
 inventory_equipment: ReadTable<InventoryEquipment>;
 inventory_movements: ReadTable<InventoryMovement>;
};
export type InventoryFunctions = {
 inventory_command: { Args: { org: string; command: string; token: string; payload: Json }; Returns: string };
 inventory_choices: { Args: { org: string; resource: string; query?: string; after_label?: string | null; after_id?: string | null; selected?: string | null; parent?: string | null; active_only?: boolean }; Returns: import('@/features/lookups/model').LookupChoice[] };
};
