'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState, type ChangeEvent } from 'react';

import { saveAsset } from '@/app/app/assets/actions';
import { revealField } from '@/components/ui/reveal-field';
import { SubmitButton } from '@/components/ui/submit-button';
import { LookupSelect } from '@/features/lookups/lookup-select';
import type { SaveState } from '@/lib/action-result';

import { assetKinds, assetStatuses, type Asset } from './model';

export function AssetForm({ asset, onCancel }: { onCancel?: () => void; asset?: Asset }) {
  const initialDraft: Record<string, string> = {
    tag: asset?.tag ?? '',
    name: asset?.name ?? '',
    kind: asset?.kind ?? 'computer',
    status: asset?.status ?? 'available',
    model: asset?.model ?? '',
    serial_number: asset?.serial_number ?? '',
    assigned_user_id: asset?.assigned_user_id ?? '',
    location_id: asset?.location_id ?? '',
    purchased_on: asset?.purchased_on ?? '',
    warranty_until: asset?.warranty_until ?? '',
  };
  const [draft, setDraft] = useState(initialDraft);
  const [state, action, pending] = useActionState(
    saveAsset.bind(null, asset?.id ?? null, asset?.revision ?? 0),
    {} as SaveState,
  );
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);
  const cancel = () => {
    if (
      !Object.keys(initialDraft).some((key) => draft[key] !== initialDraft[key]) ||
      window.confirm('Discard your unsaved asset changes?')
    )
      onCancel?.();
  };
  const change = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const field = event.target;
    setDraft((d) => ({ ...d, [field.name]: field.value }));
  };
  return (
    <form
      action={action}
      className="settings-card asset-editor"
      onInvalidCapture={(event) => revealField(event.target as HTMLElement)}
    >
      {state.error && (
        <div ref={errorRef} tabIndex={-1} className="alert alert-error" role="alert">
          {state.error}
        </div>
      )}
      <div className="asset-editor-intro">
        <h2>{asset ? 'Edit asset' : 'Register equipment'}</h2>
        <p className="muted">
          Fields marked * are required. Details are visible to IT staff and the assigned employee.
        </p>
      </div>
      <fieldset className="asset-form-section">
        <legend>Identity</legend>
        <p className="muted">Give this asset a recognizable name and a unique tag.</p>
        <div className="form-grid">
          <label className="field">
            Asset tag *
            <input
              className="input"
              name="tag"
              autoFocus={Boolean(onCancel)}
              onChange={change}
              value={draft.tag}
              required
              maxLength={60}
            />
          </label>
          <label className="field">
            Name *
            <input
              className="input"
              name="name"
              onChange={change}
              value={draft.name}
              required
              minLength={2}
              maxLength={160}
            />
          </label>
          <label className="field">
            Type *
            <select className="input" name="kind" onChange={change} value={draft.kind}>
              {Object.entries(assetKinds).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Model
            <input
              className="input"
              name="model"
              onChange={change}
              value={draft.model}
              maxLength={160}
            />
          </label>
          <label className="field">
            Serial number
            <input
              className="input"
              name="serial_number"
              onChange={change}
              value={draft.serial_number}
              maxLength={120}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="asset-form-section">
        <legend>Assignment & status</legend>
        <p className="muted">Keep ownership, location and availability up to date.</p>
        <div className="form-grid">
          <label className="field">
            Asset status *
            <select className="input" name="status" onChange={change} value={draft.status}>
              {Object.entries(assetStatuses).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <LookupSelect
            resource="people"
            name="assigned_user_id"
            label="Assigned employee"
            emptyLabel="Unassigned"
            value={draft.assigned_user_id}
            onChange={(value) => setDraft((d) => ({ ...d, assigned_user_id: value }))}
          />
          <LookupSelect
            resource="locations"
            name="location_id"
            label="Location"
            emptyLabel="Not set"
            value={draft.location_id}
            onChange={(value) => setDraft((d) => ({ ...d, location_id: value }))}
          />
        </div>
        {draft.status === 'retired' && (
          <p className="muted">
            Retirement preserves the asset and its ticket history. Unassign the employee before
            retiring it.
          </p>
        )}
      </fieldset>
      <details className="asset-form-section progressive-section">
        <summary>
          Purchase &amp; warranty <span className="muted">Optional</span>
        </summary>
        <p className="muted">Optional dates to help with replacement and support planning.</p>
        <div className="form-grid">
          <label className="field">
            Purchase date
            <input
              className="input"
              name="purchased_on"
              type="date"
              onChange={change}
              value={draft.purchased_on}
            />
          </label>
          <label className="field">
            Warranty ends
            <input
              className="input"
              name="warranty_until"
              type="date"
              onChange={change}
              value={draft.warranty_until}
            />
          </label>
        </div>
      </details>
      <div className="page-header-actions asset-editor-actions">
        <SubmitButton className="button button-primary">
          {asset ? 'Save asset' : 'Add asset'}
        </SubmitButton>
        <>
          {onCancel ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={pending}
              onClick={cancel}
            >
              Cancel editing
            </button>
          ) : (
            <Link href="/app/assets" className="button button-secondary">
              Back to assets
            </Link>
          )}
        </>
      </div>
    </form>
  );
}
