'use client';
import {useActionState,useEffect,useRef,useState,type ChangeEvent} from 'react';
import Link from 'next/link';
import {SubmitButton} from '@/components/ui/submit-button';
import {saveAsset} from '@/app/app/assets/actions';
import {assetKinds,assetStatuses,type Asset,type SaveState} from './model';
export function AssetForm({asset,people,locations}:{asset?:Asset;people:{user_id:string;display_name:string}[];locations:{id:string;name:string}[]}) {
 const [draft,setDraft]=useState<Record<string,string>>({tag:asset?.tag??'',name:asset?.name??'',kind:asset?.kind??'computer',status:asset?.status??'available',model:asset?.model??'',serial_number:asset?.serial_number??'',assigned_user_id:asset?.assigned_user_id??'',location_id:asset?.location_id??'',purchased_on:asset?.purchased_on??'',warranty_until:asset?.warranty_until??''});
 const [state,action]=useActionState(saveAsset.bind(null,asset?.id??null,asset?.revision??0),{} as SaveState);const errorRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(state.error)errorRef.current?.focus();},[state]);
 const change=(event:ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>{const field=event.target;setDraft(d=>({...d,[field.name]:field.value}));};
 return <form action={action} className="settings-card stack">{state.error&&<div ref={errorRef} tabIndex={-1} className="alert alert-error" role="alert">{state.error}</div>}<p className="muted">Fields marked * are required. Asset details are visible to IT staff and the assigned employee.</p><div className="form-grid">
 <label className="field">Asset tag *<input className="input" name="tag" onChange={change} value={draft.tag} required maxLength={60}/></label>
 <label className="field">Name *<input className="input" name="name" onChange={change} value={draft.name} required minLength={2} maxLength={160}/></label>
 <label className="field">Type *<select className="input" name="kind" onChange={change} value={draft.kind}>{Object.entries(assetKinds).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 <label className="field">Lifecycle *<select className="input" name="status" onChange={change} value={draft.status}>{Object.entries(assetStatuses).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 <label className="field">Model<input className="input" name="model" onChange={change} value={draft.model} maxLength={160}/></label>
 <label className="field">Serial number<input className="input" name="serial_number" onChange={change} value={draft.serial_number} maxLength={120}/></label>
 <label className="field">Assigned employee<select className="input" name="assigned_user_id" onChange={change} value={draft.assigned_user_id}><option value="">Unassigned</option>{people.map(p=><option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></label>
 <label className="field">Location<select className="input" name="location_id" onChange={change} value={draft.location_id}><option value="">Not set</option>{locations.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <label className="field">Purchase date<input className="input" name="purchased_on" type="date" onChange={change} value={draft.purchased_on}/></label>
 <label className="field">Warranty ends<input className="input" name="warranty_until" type="date" onChange={change} value={draft.warranty_until}/></label>
 </div><p className="muted">Retirement preserves the asset and its ticket history. Unassign the employee before retiring it.</p><div className="page-header-actions"><SubmitButton className="button button-primary">{asset?'Save asset':'Add asset'}</SubmitButton><Link href="/app/assets" className="button button-secondary">Back to assets</Link></div></form>;
}
