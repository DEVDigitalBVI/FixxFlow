'use client';
import { useId } from 'react';
import type { JsonValue } from '@/lib/events/model';
import type { ValueSchema } from './registries';
import type { Choice } from './ui-model';
import { valueLabel } from './ui-model';
import { ReferencePicker } from './reference-picker';

export function ValueControl({schema,value,onChange,label,multiple=false,activeOnly=false,parentId,describedBy,invalid,onChoices}:{schema:ValueSchema;value:JsonValue|undefined;onChange:(value:JsonValue)=>void;label:string;multiple?:boolean;activeOnly?:boolean;parentId?:string;describedBy?:string;invalid?:boolean;onChoices?:(choices:Choice[])=>void}) {
  const id=useId();
  if(schema.kind==='reference')return <ReferencePicker resource={schema.resource} value={multiple?(Array.isArray(value)?value as string[]:[]):typeof value==='string'?value:''} onChange={onChange} label={label} multiple={multiple} activeOnly={activeOnly} parentId={parentId} describedBy={describedBy} invalid={invalid} onChoices={onChoices}/>;
  const attributes={id,className:'input','aria-describedby':describedBy,'aria-invalid':invalid||undefined};
  return <div className="field"><label htmlFor={id}>{label}</label>{schema.kind==='enum'?<select {...attributes} multiple={multiple} size={multiple?4:undefined} value={multiple?(Array.isArray(value)?value as string[]:[]):String(value??'')} onChange={event=>onChange(multiple?Array.from(event.target.selectedOptions,option=>option.value):event.target.value)}>
    {!multiple&&<option value="">Choose {label.toLowerCase()}</option>}{schema.values.map(item=><option key={item} value={item}>{valueLabel(item)}</option>)}
  </select>:multiple?<textarea {...attributes} rows={3} value={Array.isArray(value)?value.join('\n'):''} onChange={event=>onChange(event.target.value.split('\n'))}/>:<input {...attributes} value={String(value??'')} maxLength={schema.kind==='string'?schema.maxLength:undefined} onChange={event=>onChange(event.target.value)}/>}
  {multiple&&<small className="muted">{schema.kind==='enum'?'Select one or more values.':'Enter one value per line.'}</small>}
  </div>;
}
