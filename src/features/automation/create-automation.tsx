'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { AutomationBuilder } from './builder';
import { automationTemplates, templateDraft } from './templates';
import { automationSummary } from './summary';
import { newDefinition } from './ui-model';

export function CreateAutomation() {
  const [selection, setSelection] = useState<string | null>(null);
  const returnFocus = useRef<string | null>(null);
  useLayoutEffect(() => { if (selection === null && returnFocus.current) document.getElementById(returnFocus.current)?.focus(); }, [selection]);
  const template = automationTemplates.find(item => item.id === selection);
  if (selection !== null) return <AutomationBuilder key={selection} draft={template ? templateDraft(template.id).definition : newDefinition()} template={template} focusOnMount onChooseTemplate={() => { returnFocus.current = `template-${selection}`; setSelection(null); }}/>;
  return <div className="stack">
    <section className="settings-card automation-scratch" aria-labelledby="scratch-heading"><div><h2 id="scratch-heading">Start from scratch</h2><p>Build an automation using the full builder. Save it disabled and test it before enabling.</p></div><div><button id="template-scratch" className="button button-primary" type="button" onClick={() => setSelection('scratch')}>Start from scratch</button></div></section>
    <section className="stack automation-templates" aria-labelledby="templates-heading"><div><h2 id="templates-heading">Popular templates</h2><p className="muted">Choose a starting point. Customize every condition and action before saving.</p></div>
      <div className="automation-template-grid">{automationTemplates.map(item => <article className="settings-card stack" key={item.id} aria-labelledby={`template-title-${item.id}`}>
        <span className="badge badge-inactive">{item.category}</span><h3 id={`template-title-${item.id}`}>{item.name}</h3><p>{item.description}</p><p className="muted">{item.useCase}</p>
        <details><summary>Preview <span className="sr-only">{item.name}</span></summary><p>{automationSummary(item.definition)}</p><p className="muted">{item.guidance}</p></details>
        <button id={`template-${item.id}`} type="button" className="button button-secondary" aria-label={`Use ${item.name} template`} onClick={() => setSelection(item.id)}>Use template</button>
      </article>)}</div>
    </section>
  </div>;
}
