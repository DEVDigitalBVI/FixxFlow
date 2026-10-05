'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AutomationBuilder } from './builder';
import { ReferencePicker } from './reference-picker';
import { loadAutomationChoices } from './choice-client';
import { automationSummary } from './summary';
import type { Choice, Labels } from './ui-model';
import { parsePortablePackage, portableLimits, portablePreview, portableResources, resolvePortableDraft, suggestPortableReference, PortabilityError, type PortablePackage, type PortableReference } from './portable';
import type { AutomationDefinition } from './model';
import { isRecord } from './values';

export function MappingRow({ reference, value, onChange, onChoices, requiredActive = false, showError = false }: { requiredActive?: boolean; showError?: boolean; reference: PortableReference; value: string; onChange: (id: string) => void; onChoices: (rows: Choice[]) => void }) {
  const [suggestion, setSuggestion] = useState<Choice | null>(null), [status, setStatus] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  return <fieldset className="automation-row stack"><legend>{reference.sourceLabel}</legend>
    <p className="muted">Source {reference.kind} · {value ? 'Destination confirmed' : 'Choose a destination'}</p>
    <ReferencePicker resource={portableResources[reference.kind]} label={`Destination ${reference.kind} for ${reference.sourceLabel}`} value={value} onChange={id => onChange(String(id))} activeOnly={requiredActive} invalid={showError && !value} describedBy={showError && !value ? `mapping-error-${reference.key}` : undefined} onChoices={onChoices}/>
    {showError && !value && <p id={`mapping-error-${reference.key}`} className="alert alert-error">Select a destination {reference.kind} before continuing.</p>}
    {!value && <div className="automation-inline"><button type="button" className="button button-quiet" disabled={status === 'Looking for a match…'} onClick={async () => {
      pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
      setStatus('Looking for a match…'); setSuggestion(null);
      try {
        const result = await loadAutomationChoices(portableResources[reference.kind], reference.sourceLabel, 1, [], controller.signal);
        if (controller.signal.aborted) return;
        const match = suggestPortableReference(reference, result.rows, result.hasNext);
        setSuggestion(match); setStatus(match ? `Suggested: ${match.label}. Review and confirm this destination.` : 'No unique active match. Select the destination yourself.');
      } catch { if (!controller.signal.aborted) setStatus('Suggestions could not load. You can still select a destination.'); }
    }}>Find a suggested match</button>{suggestion && <button type="button" className="button button-secondary" onClick={() => { onChoices([suggestion]); onChange(suggestion.id); setStatus(`Confirmed: ${suggestion.label}.`); }}>Confirm suggested match</button>}</div>}
    <p role="status" className="muted">{status}</p>
  </fieldset>;
}

export function ImportAutomation() {
  const [pkg, setPackage] = useState<PortablePackage | null>(null), [mapping, setMapping] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Labels>({}), [draft, setDraft] = useState<AutomationDefinition | null>(null);
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [mappingPage, setMappingPage] = useState(0);
  const feedback = useRef<HTMLElement>(null), review = useRef<HTMLHeadingElement>(null), selection = useRef(0);
  useEffect(() => { if (error) feedback.current?.focus(); }, [error]);
  useEffect(() => { if (pkg) review.current?.focus(); }, [pkg]);
  const choices = useCallback((rows: Choice[]) => setLabels(previous => ({ ...previous, ...Object.fromEntries(rows.map(row => [row.id, row.label])) })), []);
  if (draft) return <><aside className="alert alert-info">Imported draft · disabled. Review every condition and action, then test before saving. Nothing has been imported into your organization yet.</aside><AutomationBuilder draft={draft} initialLabels={labels} imported focusOnMount onChooseTemplate={() => setDraft(null)}/></>;
  const preview = pkg ? portablePreview(pkg) : null;
  const unresolved = pkg?.references.filter(ref => !mapping[ref.key]).length ?? 0;
  return <div className="stack automation-builder automation-portability">
    <section className="settings-card stack" aria-labelledby="import-file-heading"><h2 id="import-file-heading">Bring your workflow with you</h2><p>Import one automation, review its settings and choose the people and teams in this organization. Imported rules are always saved disabled.</p>
      <div className="field"><label htmlFor="automation-import-file">Automation package</label><input id="automation-import-file" className="input" type="file" accept=".json,application/json" aria-describedby={error && !pkg ? 'import-file-help import-error' : 'import-file-help'} aria-invalid={Boolean(error && !pkg) || undefined} onChange={async event => {
        const file = event.target.files?.[0], current = ++selection.current;
        setError(''); setPackage(null); setMapping({}); setLabels({}); setMappingPage(0);
        if (!file) { setPending(false); return; }
        setPending(true);
        try {
          if (file.size > portableLimits.bytes) throw new PortabilityError('Choose a file smaller than 512 KB.');
          const result = parsePortablePackage(await file.text());
          if (current === selection.current) setPackage(result);
        } catch (cause) { if (current === selection.current) setError(cause instanceof PortabilityError ? cause.message : 'The file could not be read. Choose it again.'); }
        finally { if (current === selection.current) setPending(false); }
      }}/><small id="import-file-help" className="muted">FixxFlow JSON · one automation · up to 512 KB. The file is reviewed in your browser and is not uploaded to attachment storage.</small></div>
      <p role="status">{pending ? 'Checking your package…' : pkg ? 'Package validated. Review the automation below.' : 'Nothing is saved until you review and save the draft.'}</p>
    </section>
    {error && <section ref={feedback} tabIndex={-1} role="alert" className="alert alert-error" id="import-error"><h2>Review your import</h2><p>{error}</p><p>Nothing was saved. Correct the destination selections or choose another file.</p></section>}
    {pkg && preview && <>
      <section className="settings-card stack" aria-labelledby="import-review-heading"><h2 id="import-review-heading" ref={review} tabIndex={-1}>{preview.definition.name}</h2>{preview.definition.description && <p>{preview.definition.description}</p>}<p className="automation-summary">{automationSummary(preview.definition, preview.labels)}</p><p className="muted">Preview uses names from the source package. Review all text and settings before saving. No source organization identifiers are reused.</p></section>
      {pkg.references.length > 0 && <section className="settings-card stack" aria-labelledby="import-map-heading"><h2 id="import-map-heading" tabIndex={-1}>Map to your organization</h2><p>Choose each destination explicitly. Suggested matches are not confirmed until you select them.</p>{pkg.references.slice(mappingPage * 10, (mappingPage + 1) * 10).map(ref => <MappingRow key={ref.key} reference={ref} showError={Boolean(error)} requiredActive={pkg.rules[0].actions.some(action => Object.values(action.configuration).some(value => isRecord(value) && value.reference === ref.key))} value={mapping[ref.key] ?? ''} onChange={id => setMapping(previous => ({ ...previous, [ref.key]: id }))} onChoices={choices}/>)}<p role="status">{unresolved ? `${unresolved} ${unresolved === 1 ? 'reference needs' : 'references need'} a destination.` : 'All destinations selected. Current validity is checked again when you test or save.'}</p>{pkg.references.length > 10 && <nav className="automation-inline" aria-label="Reference mapping pages"><button type="button" className="button button-secondary" disabled={mappingPage === 0} onClick={() => {setMappingPage(mappingPage - 1); document.getElementById('import-map-heading')?.focus();}}>Previous references</button><span>Page {mappingPage + 1} of {Math.ceil(pkg.references.length / 10)}</span><button type="button" className="button button-secondary" disabled={(mappingPage + 1) * 10 >= pkg.references.length} onClick={() => {setMappingPage(mappingPage + 1); document.getElementById('import-map-heading')?.focus();}}>Next references</button></nav>}</section>}
      <div className="automation-inline"><button type="button" className="button button-primary" onClick={() => {
        try { const result = resolvePortableDraft(pkg, mapping); setError(''); setDraft(result.definition); }
        catch (cause) { const firstMissing = pkg.references.findIndex(ref => !mapping[ref.key]); if (firstMissing >= 0) setMappingPage(Math.floor(firstMissing / 10)); setError(cause instanceof PortabilityError ? cause.message : 'Review the destination selections.'); }
      }}>Review and test draft</button><span className="muted">Next: the full builder, Test Automation and Save as disabled.</span></div>
    </>}
  </div>;
}
