'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { inventoryMutation } from '@/app/app/inventory/actions';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { formString } from '@/lib/form-data';
import type {
  InventoryEquipment,
  InventoryItem,
  InventoryRequest,
} from '@/types/inventory-database';

import { contextLabel } from './model';

export function CommandFields({
  command,
  id,
  token,
}: {
  command: string;
  id?: string;
  token: string;
}) {
  return (
    <>
      <input type="hidden" name="command" value={command} />
      <input type="hidden" name="token" value={token} />
      {id && <input type="hidden" name="id" value={id} />}
    </>
  );
}
export function StockForm({
  item,
  command,
  token,
}: {
  item: InventoryItem;
  command: 'receive' | 'correct';
  token: string;
}) {
  const [count, setCount] = useState(1);
  const [review, setReview] = useState<{
    quantity: string;
    note: string;
    equipment: string[];
  } | null>(null);
  const fields = useRef<HTMLFieldSetElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    returnFocus = useRef(false),
    id = useId();
  useEffect(() => {
    if (review) heading.current?.focus();
    else if (returnFocus.current) {
      fields.current?.querySelector?.<HTMLInputElement>('input[name="quantity"]')?.focus();
      returnFocus.current = false;
    }
  }, [review]);
  const equipment = item.kind === 'equipment';
  const reviewReceipt = () => {
    const controls = fields.current?.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('input, select, textarea');
    if (!controls || !fields.current?.form) return;
    for (const control of controls) if (!control.reportValidity()) return;
    const form = new FormData(fields.current.form);
    const assets = Array.from(
      fields.current.querySelectorAll<HTMLSelectElement>('select[name="assets"]'),
    ).map((select) => select.selectedOptions[0]?.label ?? 'Equipment');
    setReview({
      quantity: formString(form, 'quantity', ''),
      note: formString(form, 'note', ''),
      equipment: assets,
    });
  };
  return (
    <ActionForm
      action={async (data) => {
        if (command === 'receive' && !review) {
          reviewReceipt();
          return {};
        }
        const result = await inventoryMutation(data);
        if (result.error) {
          returnFocus.current = true;
          setReview(null);
        }
        return result;
      }}
      className="stack inventory-editor"
    >
      <CommandFields command={command} id={item.id} token={token} />
      <fieldset ref={fields} hidden={Boolean(review)} className="stack inventory-receipt-fields">
        <legend>{command === 'receive' ? 'What arrived?' : 'Correct stock'}</legend>
        <p className="muted">
          {command === 'receive'
            ? 'Record items that have physically arrived. Review the receipt before adding stock.'
            : 'Correct the stock record. Use a negative quantity to remove stock and explain the correction.'}
        </p>
        <label>
          {command === 'receive' ? 'Quantity received' : 'Quantity change (negative to remove)'}
          <input
            className="input"
            name="quantity"
            type="number"
            step="1"
            min={command === 'receive' ? 1 : undefined}
            max={equipment ? 100 : 2147483647}
            required
            defaultValue={1}
            onChange={(e) => setCount(Math.min(100, Math.abs(Number(e.target.value)) || 0))}
          />
        </label>
        {equipment &&
          Array.from({ length: count }, (_, index) => (
            <LookupSelect
              key={index}
              resource="inventory_assets"
              name="assets"
              label={`Equipment ${index + 1} · asset tag and serial`}
              required
            />
          ))}
        <label>
          {command === 'correct'
            ? 'Correction reason (required)'
            : 'Receipt reference or note (optional)'}
          <textarea
            className="input"
            name="note"
            required={command === 'correct'}
            maxLength={2000}
          />
        </label>
        <p className="muted">
          {equipment
            ? 'Select existing available assets. Record new equipment in Assets first. Up to 100 units per receipt.'
            : 'Consumables are counted in quantities.'}{' '}
          The receiving user and date are recorded automatically.
        </p>
      </fieldset>
      {review && (
        <section className="stack" aria-labelledby={id}>
          <h3 id={id} ref={heading} tabIndex={-1}>
            Review stock receipt
          </h3>
          <dl className="asset-facts">
            <dt>Item</dt>
            <dd>{item.name}</dd>
            <dt>Quantity received</dt>
            <dd>{review.quantity}</dd>
            <dt>For department</dt>
            <dd>{item.department_name}</dd>
            <dt>Stored at</dt>
            <dd>{item.location_name}</dd>
          </dl>
          {review.equipment.length > 0 && (
            <ul>
              {review.equipment.map((name, index) => (
                <li key={index}>{name}</li>
              ))}
            </ul>
          )}
          {review.note && <p className="ticket-description">{review.note}</p>}
          <p className="muted">This adds stock. It does not issue items to an employee.</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              returnFocus.current = true;
              setReview(null);
            }}
          >
            Edit receipt
          </button>
        </section>
      )}
      {command === 'receive' && !review ? (
        <button className="button button-primary" type="button" onClick={reviewReceipt}>
          Review receipt
        </button>
      ) : (
        <SubmitButton className="button button-primary">
          {command === 'receive' ? 'Record received stock' : 'Record correction'}
        </SubmitButton>
      )}
    </ActionForm>
  );
}
export function RequestForm({ item, token }: { item: InventoryItem; token: string }) {
  return (
    <ActionForm action={inventoryMutation} className="stack inventory-editor">
      <CommandFields command="request" id={item.id} token={token} />
      <p>
        Requesting for <strong>{item.department_name}</strong>. Submission does not reserve stock.
      </p>
      <label>
        Quantity
        <input
          className="input"
          name="quantity"
          type="number"
          min="1"
          step="1"
          max={item.kind === 'equipment' ? 100 : 2147483647}
          required
          defaultValue={1}
        />
      </label>
      <LookupSelect
        resource="inventory_people"
        name="recipient"
        label="Employee receiving the item (optional)"
      />
      <label>
        Delivery location or recipient details
        <input
          className="input"
          name="destination"
          required
          maxLength={240}
          placeholder="Employee name, office or departmental location"
        />
      </label>
      <p className="muted">
        Include where the items should go, even when you have selected an employee.
      </p>
      {item.kind === 'consumable' && (
        <LookupSelect
          resource="inventory_printers"
          name="printer"
          label="Printer (optional, for toner)"
        />
      )}
      <label>
        Reason (optional)
        <textarea className="input" name="reason" maxLength={20000} />
      </label>
      <SubmitButton className="button button-primary">Submit inventory request</SubmitButton>
    </ActionForm>
  );
}
export function ReviewForm({
  request,
  equipment,
  command,
  token,
}: {
  request: InventoryRequest;
  equipment: boolean;
  command: 'approve' | 'decline' | 'information' | 'cancel';
  token: string;
}) {
  return (
    <ActionForm action={inventoryMutation} className="stack inventory-editor">
      <CommandFields command={command} id={request.id} token={token} />
      {command === 'approve' &&
        equipment &&
        Array.from({ length: Math.min(request.quantity, 100) }, (_, i) => (
          <LookupSelect
            key={i}
            resource="inventory_stored"
            parentId={request.item_id}
            name="assets"
            label={`Reserve equipment ${i + 1}`}
            required
          />
        ))}
      {command !== 'approve' && (
        <label>
          {command === 'information'
            ? 'Question for the requester'
            : command === 'decline'
              ? 'Decline reason'
              : 'Cancellation note (optional)'}
          <textarea
            className="input"
            name="note"
            required={command !== 'cancel'}
            maxLength={2000}
          />
        </label>
      )}
      <SubmitButton
        className={`button ${command === 'decline' ? 'button-danger' : 'button-secondary'}`}
      >
        {
          {
            approve: 'Approve and reserve',
            decline: 'Decline request',
            information: 'Ask for more information',
            cancel: 'Cancel inventory request',
          }[command]
        }
      </SubmitButton>
    </ActionForm>
  );
}
export function IssueForm({
  request,
  units,
  token,
}: {
  request: InventoryRequest;
  units: InventoryEquipment[];
  token: string;
}) {
  return (
    <ActionForm action={inventoryMutation} className="stack inventory-editor">
      <CommandFields command="issue" id={request.id} token={token} />
      <p>
        Hand over the full quantity: <strong>{request.quantity}</strong>. Recipient:{' '}
        {contextLabel(request.context, 'recipient') || 'Departmental destination'}. Destination:{' '}
        <strong>{request.destination}</strong>.
      </p>
      <input type="hidden" name="recipient" value={request.recipient_id ?? ''} />
      <input type="hidden" name="destination" value={request.destination} />
      {units.map((unit) => (
        <label key={unit.asset_id}>
          <input type="checkbox" name="assets" value={unit.asset_id} required /> Confirm{' '}
          {contextLabel(unit.asset_context, 'tag')} · {contextLabel(unit.asset_context, 'name')} ·{' '}
          {contextLabel(unit.asset_context, 'serial') || 'No serial recorded'}
        </label>
      ))}
      <label>
        <input type="checkbox" required /> I confirm the recipient or destination and actual
        handover.
      </label>
      <label>
        Handover note (optional)
        <textarea className="input" name="note" maxLength={2000} />
      </label>
      <SubmitButton className="button button-primary">Mark as issued</SubmitButton>
    </ActionForm>
  );
}
export function PermissionsForm({
  id,
  name,
  departments,
  grants,
  manager,
  token,
}: {
  id: string;
  name: string;
  departments: { id: string; name: string; is_active: boolean }[];
  grants: string[];
  manager: boolean;
  token: string;
}) {
  const activeDepartments = departments.filter((d) => d.is_active);
  const grantedDepartments = departments.filter((d) => grants.includes(d.id));
  return (
    <section className="person-inventory-access" aria-labelledby={`inventory-access-${id}`}>
      <header className="inventory-access-heading">
        <div>
          <h4 id={`inventory-access-${id}`}>Inventory access</h4>
          <p className="muted">
            Control stock management and department requests independently of workspace role.
          </p>
        </div>
      </header>
      <dl className="inventory-access-summary">
        <div>
          <dt>Stock management</dt>
          <dd>{manager ? 'Can manage and fulfill requests' : 'No management access'}</dd>
        </div>
        <div>
          <dt>Department requests</dt>
          <dd>
            {grantedDepartments.length
              ? grantedDepartments
                  .map((d) => `${d.name}${d.is_active ? '' : ' (inactive)'}`)
                  .join(', ')
              : 'No departments assigned'}
          </dd>
        </div>
      </dl>
      <details className="inventory-access-editor">
        <summary className="button button-secondary">
          Edit inventory access<span className="sr-only"> for {name}</span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <ActionForm action={inventoryMutation} className="inventory-permissions-form">
          <CommandFields command="permissions" id={id} token={token} />
          <fieldset className="inventory-permission-group">
            <legend>
              Stock management<span className="sr-only"> for {name}</span>
            </legend>
            <label className="inventory-permission-option">
              <input type="checkbox" name="manager" defaultChecked={manager} />
              <span>
                <strong>Manage inventory and fulfill requests</strong>
                <span>
                  Receive and correct stock, review requests, and issue items across departments.
                </span>
              </span>
            </label>
          </fieldset>
          <fieldset
            className="inventory-permission-group"
            aria-describedby={`inventory-departments-hint-${id}`}
          >
            <legend>
              Request department inventory<span className="sr-only"> for {name}</span>
            </legend>
            <p className="muted" id={`inventory-departments-hint-${id}`}>
              Choose the departments this person can request items for. Uncheck a department to
              remove access.
            </p>
            {activeDepartments.length ? (
              <div className="inventory-department-options">
                {activeDepartments.map((d) => (
                  <label className="inventory-permission-option" key={d.id}>
                    <input
                      type="checkbox"
                      name="departments"
                      value={d.id}
                      defaultChecked={grants.includes(d.id)}
                    />
                    <span>{d.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="inventory-permissions-empty">
                No active departments. Add a department in Settings to enable requests.
              </p>
            )}
          </fieldset>
          <div className="inventory-permissions-footer">
            <p className="muted">Changes apply when you save.</p>
            <SubmitButton className="button button-primary" pendingLabel="Saving permissions…">
              Save inventory permissions<span className="sr-only"> for {name}</span>
            </SubmitButton>
          </div>
        </ActionForm>
      </details>
    </section>
  );
}
