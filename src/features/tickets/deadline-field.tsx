'use client';
import { useId, useState } from 'react';
import { deadlineCandidates, deadlineInputValue } from './deadlines';
export function DeadlineField({ timeZone, value = null, required = false, label = "Manual due date", hint = "Optional. SLA targets are calculated separately." }: { timeZone: string; value?: string | null; label?: string; hint?: string; required?: boolean }) {
  const [zone] = useState(timeZone);
  const [local, setLocal] = useState(() => deadlineInputValue(value, zone));
  const [occurrence, setOccurrence] = useState(() => {
    const candidates = deadlineCandidates(deadlineInputValue(value, zone), zone);
    return value && candidates.length > 1 ? (Math.floor(new Date(value).getTime() / 60000) === Date.parse(candidates[0]) / 60000 ? 'earlier' : 'later') : '';
  });
  const id = useId();
  const candidates = deadlineCandidates(local, zone);
  return <div className="field"><input type="hidden" name="dueTimezone" value={zone}/><label htmlFor={id}>{label}</label><input className="input" id={id} name="dueAt" type="datetime-local" required={required} value={local} onChange={event => { setLocal(event.target.value); setOccurrence(''); }} aria-describedby={`${id}-hint`}/><small id={`${id}-hint`} className="muted">{zone}. {hint}</small>{local && !candidates.length && <p role="alert">This local time does not exist. Choose another time.</p>}{candidates.length > 1 && <label>This time occurs twice<select className="input" name="dueOccurrence" required value={occurrence} onChange={event => setOccurrence(event.target.value)}><option value="">Choose an occurrence</option><option value="earlier">First occurrence ({candidates[0]})</option><option value="later">Second occurrence ({candidates.at(-1)})</option></select></label>}</div>;
}
