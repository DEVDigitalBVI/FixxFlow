import type { Asset, AssetKind, AssetStatus } from "@/types/database";
export type { Asset } from "@/types/database";
export const assetKinds = {computer:'Computer',phone:'Phone',printer:'Printer',network:'Network equipment',software:'Software',other:'Other'} as const satisfies Record<AssetKind, string>;
export const assetStatuses = {available:'Available',in_use:'In use',repair:'Under repair',retired:'Retired'} as const satisfies Record<AssetStatus, string>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assetInput(form:FormData) {
 const value=(key:string)=>String(form.get(key)??'').trim();
 const data={tag:value('tag').toUpperCase(),name:value('name'),kind:value('kind') as Asset['kind'],status:value('status') as Asset['status'],serial_number:value('serial_number')||null,model:value('model')||null,assigned_user_id:value('assigned_user_id')||null,location_id:value('location_id')||null,purchased_on:value('purchased_on')||null,warranty_until:value('warranty_until')||null};
 if(!data.tag || data.tag.length>60 || data.name.length<2 || data.name.length>160 || !Object.hasOwn(assetKinds,data.kind) || !Object.hasOwn(assetStatuses,data.status) || (data.serial_number?.length??0)>120 || (data.model?.length??0)>160) return {error:'Check the required fields and their maximum lengths.'};
 if([data.assigned_user_id,data.location_id].some(v=>v&&!uuid.test(v)))return {error:'Choose a valid employee and location.'};
 if([data.purchased_on,data.warranty_until].some(v=>v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000')||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)))return {error:'Enter valid dates.'};
 if(data.purchased_on&&data.warranty_until&&data.warranty_until<data.purchased_on)return {error:'Warranty end cannot be before the purchase date.'};
 if(data.status==='retired'&&data.assigned_user_id)return {error:'Unassign the employee before retiring this asset.'};
 return {data};
}
