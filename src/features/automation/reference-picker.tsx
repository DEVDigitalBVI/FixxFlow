'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { loadAutomationChoices } from './choice-client';
import type { Choice } from './ui-model';

export function ReferencePicker({ resource, value, onChange, label, multiple=false, activeOnly=false, parentId, describedBy, invalid, onChoices }: {
  resource: string; value: string | readonly string[]; onChange: (value: string | string[])=>void; label: string;
  multiple?: boolean; activeOnly?: boolean; parentId?: string; describedBy?: string; invalid?: boolean; onChoices?: (choices: Choice[])=>void;
}) {
  const id=useId(); const [query,setQuery]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [state,setState]=useState<{rows:Choice[];hasNext:boolean;pending:boolean;error:string}>({rows:[],hasNext:false,pending:true,error:''});
  const previousQuery=useRef(query);
  const selected=(Array.isArray(value)?value:[value]).filter(Boolean).join(',');
  useEffect(()=>{
    let cancelled=false;
    const controller=new AbortController();
    const delay=query && query!==previousQuery.current?300:0;
    previousQuery.current=query;
    const timer=setTimeout(async()=>{
      setState(previous=>({...previous,pending:true,error:''}));
      const ids=selected?selected.split(','):[];
      try {
      const {rows,hasNext}=await loadAutomationChoices(resource,query,page,ids,controller.signal);
      if(cancelled)return;
      setState({rows,hasNext,pending:false,error:''});onChoices?.(rows);
      } catch { if(!cancelled)setState(previous=>({...previous,pending:false,error:'Choices could not load. Try again.'})); }
    },delay);
    return ()=>{cancelled=true;clearTimeout(timer);controller.abort();};
  },[resource,query,page,selected,refresh,onChoices]);
  const visible=state.rows.filter(row=>!parentId||row.parentId===parentId||selected.split(',').includes(row.id));
  return <div className="field automation-picker">
    <label htmlFor={id}>{label}</label>
    <label className="sr-only" htmlFor={`${id}-search`}>Search {label.toLowerCase()}</label>
    <input id={`${id}-search`} className="input input-compact" type="search" value={query} placeholder={`Search ${label.toLowerCase()}`} onChange={event=>{setQuery(event.target.value);setPage(1);}}/>
    <select id={id} className="input" multiple={multiple} size={multiple?4:undefined} value={multiple?[...(value as readonly string[])]:value as string} aria-invalid={invalid||undefined} aria-describedby={describedBy} onChange={event=>onChange(multiple?Array.from(event.target.selectedOptions,option=>option.value):event.target.value)}>
      {!multiple&&<option value="">Choose {label.toLowerCase()}</option>}
      {selected.split(',').filter(item=>item&&!visible.some(row=>row.id===item)).map(item=><option key={item} value={item}>Unavailable selection</option>)}
      {visible.map(row=><option key={row.id} value={row.id} disabled={activeOnly&&!row.active}>{row.label}{!row.active?' (inactive)':''}</option>)}
    </select>
    {multiple&&<small className="muted">Select one or more. Use Control or Command to add a selection.</small>}
    <span className="muted" role="status">{state.pending?'Loading choices…':state.error||(!visible.length?query?'No matches. Try a different search.':'No choices available. Ask an administrator to review the available records.':`Page ${page}`)}</span>
    <div className="automation-inline">{state.error&&<button type="button" className="button button-secondary" onClick={()=>setRefresh(value=>value+1)}>Try again</button>}{page>1&&<button type="button" className="button button-quiet" onClick={()=>setPage(page-1)}>Previous choices</button>}{state.hasNext&&<button type="button" className="button button-quiet" onClick={()=>setPage(page+1)}>More choices</button>}</div>
  </div>;
}
