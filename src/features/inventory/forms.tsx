'use client';
import { useState } from 'react';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { inventoryMutation } from '@/app/app/inventory/actions';
import type { InventoryItem, InventoryRequest, InventoryEquipment } from '@/types/inventory-database';
import { contextLabel } from './model';

export function CommandFields({ command, id, token }: { command: string; id?: string; token: string }) {
 return <><input type="hidden" name="command" value={command}/><input type="hidden" name="token" value={token}/>{id && <input type="hidden" name="id" value={id}/>}</>;
}
export function StockForm({ item, command, token }: { item: InventoryItem; command: 'receive' | 'correct'; token: string }) {
 const [count, setCount] = useState(1);
 const equipment = item.kind === 'equipment';
 return <ActionForm action={inventoryMutation} className="stack inventory-editor"><CommandFields command={command} id={item.id} token={token}/>
  <label>{command === 'receive' ? 'Quantity received' : 'Quantity change (negative to remove)'}<input className="input" name="quantity" type="number" step="1" min={command === 'receive' ? 1 : undefined} max={equipment ? 100 : 2147483647} required defaultValue={1} onChange={e => setCount(Math.min(100, Math.abs(Number(e.target.value)) || 0))}/></label>
  {equipment && Array.from({ length: count }, (_, index) => <LookupSelect key={index} resource="inventory_assets" name="assets" label={`Equipment ${index + 1} · asset tag and serial`} required/>)}
  <label>{command === 'correct' ? 'Correction reason (required)' : 'Receipt reference or note (optional)'}<textarea className="input" name="note" required={command === 'correct'} maxLength={2000}/></label>
  <p className="muted">{equipment ? 'Select existing available assets. Record new equipment in Assets first. Up to 100 units per receipt.' : 'Consumables are counted in quantities.'} The receiving user and date are recorded automatically.</p>
  <SubmitButton className="button button-primary">{command === 'receive' ? 'Record received stock' : 'Record correction'}</SubmitButton>
 </ActionForm>;
}
export function RequestForm({ item, token }: { item: InventoryItem; token: string }) {
 return <ActionForm action={inventoryMutation} className="stack inventory-editor"><CommandFields command="request" id={item.id} token={token}/>
  <p>Requesting for <strong>{item.department_name}</strong>. Submission does not reserve stock.</p>
  <label>Quantity<input className="input" name="quantity" type="number" min="1" step="1" max={item.kind === 'equipment' ? 100 : 2147483647} required defaultValue={1}/></label>
  <LookupSelect resource="inventory_people" name="recipient" label="Intended employee (optional)"/>
  <label>Recipient or destination details<input className="input" name="destination" required maxLength={240} placeholder="Employee name, office or departmental location"/></label>
  {item.kind === 'consumable' && <LookupSelect resource="inventory_printers" name="printer" label="Printer (optional, for toner)"/>}
  <label>Reason (optional)<textarea className="input" name="reason" maxLength={20000}/></label>
  <SubmitButton className="button button-primary">Submit inventory request</SubmitButton>
 </ActionForm>;
}
export function ReviewForm({ request, equipment, command, token }: { request: InventoryRequest; equipment: boolean; command: 'approve' | 'decline' | 'information' | 'cancel'; token: string }) {
 return <ActionForm action={inventoryMutation} className="stack inventory-editor"><CommandFields command={command} id={request.id} token={token}/>
  {command === 'approve' && equipment && Array.from({ length: Math.min(request.quantity,100) }, (_, i) => <LookupSelect key={i} resource="inventory_stored" parentId={request.item_id} name="assets" label={`Reserve equipment ${i + 1}`} required/>)}
  {command !== 'approve' && <label>{command === 'information' ? 'Question for the requester' : command === 'decline' ? 'Decline reason' : 'Cancellation note (optional)'}<textarea className="input" name="note" required={command !== 'cancel'} maxLength={2000}/></label>}
  <SubmitButton className={`button ${command === 'decline' ? 'button-danger' : 'button-secondary'}`}>{({ approve: 'Approve and reserve', decline: 'Decline request', information: 'Ask for more information', cancel: 'Cancel inventory request' })[command]}</SubmitButton>
 </ActionForm>;
}
export function IssueForm({ request, units, token }: { request: InventoryRequest; units: InventoryEquipment[]; token: string }) {
 return <ActionForm action={inventoryMutation} className="stack inventory-editor"><CommandFields command="issue" id={request.id} token={token}/>
  <p>Hand over the full quantity: <strong>{request.quantity}</strong>. Recipient: {contextLabel(request.context,'recipient') || 'Departmental destination'}. Destination: <strong>{request.destination}</strong>.</p>
  <input type="hidden" name="recipient" value={request.recipient_id ?? ''}/><input type="hidden" name="destination" value={request.destination}/>
  {units.map(unit => <label key={unit.asset_id}><input type="checkbox" name="assets" value={unit.asset_id} required/> Confirm {contextLabel(unit.asset_context,'tag')} · {contextLabel(unit.asset_context,'name')} · {contextLabel(unit.asset_context,'serial') || 'No serial recorded'}</label>)}
  <label><input type="checkbox" required/> I confirm the recipient or destination and actual handover.</label>
  <label>Handover note (optional)<textarea className="input" name="note" maxLength={2000}/></label>
  <SubmitButton className="button button-primary">Mark as issued</SubmitButton>
 </ActionForm>;
}
export function PermissionsForm({ id, name, departments, grants, manager, token }: { id: string; name: string; departments: { id: string; name: string; is_active: boolean }[]; grants: string[]; manager: boolean; token: string }) {
 return <ActionForm action={inventoryMutation} className="stack inventory-editor"><CommandFields command="permissions" id={id} token={token}/>
  <fieldset className="stack"><legend>Inventory capabilities for {name}</legend>
   <label><input type="checkbox" name="manager" defaultChecked={manager}/> Manage inventory and fulfill requests</label>
   <fieldset className="stack"><legend>Request department inventory</legend><p className="muted">Select every department this person may request for. Uncheck to revoke access.</p>
    {departments.filter(d => d.is_active).map(d => <label key={d.id}><input type="checkbox" name="departments" value={d.id} defaultChecked={grants.includes(d.id)}/> {d.name}</label>)}
    {!departments.some(d => d.is_active) && <p>No active departments. Add a department in Administration.</p>}
   </fieldset>
  </fieldset><SubmitButton className="button button-secondary">Save inventory permissions</SubmitButton>
 </ActionForm>;
}
