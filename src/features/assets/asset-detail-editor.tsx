'use client';

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AssetForm } from '@/features/assets/asset-form';

export function AssetDetailEditor({ children, ...props }: Omit<ComponentProps<typeof AssetForm>, 'onCancel'> & { children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      editButton.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);

  if (editing) return <AssetForm {...props} onCancel={() => { restoreFocus.current = true; setEditing(false); }}/>;
  return <section className="settings-card asset-record" aria-labelledby="asset-record-heading">
    <header className="asset-record-header"><div><h2 id="asset-record-heading">Asset overview</h2><p className="muted">Equipment details and ownership at a glance.</p></div><button ref={editButton} type="button" className="button button-primary" onClick={() => setEditing(true)}>Edit asset</button></header>
    {children}
  </section>;
}
