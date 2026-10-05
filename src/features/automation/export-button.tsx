'use client';
import { useState } from 'react';
import { automationPath } from './ui-model';
import { portableFilename } from './portable';

export function ExportAutomationButton({ id, name }: { id: string; name: string }) {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  return <div className="stack"><button type="button" className="button button-secondary" disabled={pending} onClick={async () => {
    setPending(true); setError('');
    try {
      const response = await fetch(`${automationPath}/${encodeURIComponent(id)}/export`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      if (!response.ok) {
        const result: unknown = await response.json();
        if (result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' && result.error.length <= 1000) { setError(result.error); return; }
        throw Error('export_failed');
      }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = portableFilename(name); document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Export could not complete. Check your connection and sign-in, then try again.'); }
    finally { setPending(false); }
  }}>{pending ? 'Exporting…' : 'Export'}<span className="sr-only"> {name}</span></button>{error && <p role="alert" className="alert alert-error">{error}</p>}</div>;
}
