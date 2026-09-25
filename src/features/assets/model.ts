export const assetKinds = {computer:'Computer',phone:'Phone',printer:'Printer',network:'Network equipment',software:'Software',other:'Other'} as const;
export const assetStatuses = {available:'Available',in_use:'In use',repair:'Under repair',retired:'Retired'} as const;
export type Asset = {id:string;organization_id:string;tag:string;name:string;kind:keyof typeof assetKinds;status:keyof typeof assetStatuses;serial_number:string|null;model:string|null;assigned_user_id:string|null;location_id:string|null;purchased_on:string|null;warranty_until:string|null;revision:number;created_at:string;updated_at:string};
export type SaveState = {error?:string;success?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assetInput(form:FormData) {
 const value=(key:string)=>String(form.get(key)??'').trim();
 const data={tag:value('tag').toUpperCase(),name:value('name'),kind:value('kind') as Asset['kind'],status:value('status') as Asset['status'],serial_number:value('serial_number')||null,model:value('model')||null,assigned_user_id:value('assigned_user_id')||null,location_id:value('location_id')||null,purchased_on:value('purchased_on')||null,warranty_until:value('warranty_until')||null};
 if(!data.tag || data.tag.length>60 || data.name.length<2 || data.name.length>160 || !Object.hasOwn(assetKinds,data.kind) || !Object.hasOwn(assetStatuses,data.status) || (data.serial_number?.length??0)>120 || (data.model?.length??0)>160) return {error:'Check the required fields and their maximum lengths.'};
 if([data.assigned_user_id,data.location_id].some(v=>v&&!uuid.test(v)))return {error:'Choose a valid employee and location.'};
 if([data.purchased_on,data.warranty_until].some(v=>v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))))return {error:'Enter valid dates.'};
 if(data.purchased_on&&data.warranty_until&&data.warranty_until<data.purchased_on)return {error:'Warranty end cannot be before the purchase date.'};
 if(data.status==='retired'&&data.assigned_user_id)return {error:'Unassign the employee before retiring this asset.'};
 return {data};
}
export function pageNumber(value:string|undefined) {const n=Number(value);return Number.isSafeInteger(n)&&n>0?Math.min(n,100000):1;}
