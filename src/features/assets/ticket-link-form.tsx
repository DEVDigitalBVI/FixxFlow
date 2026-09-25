'use client';
import {useActionState} from 'react';
import {SubmitButton} from '@/components/ui/submit-button';
import {changeAssetLink} from '@/app/app/assets/actions';
import type {SaveState} from './model';
export function AssetLinkForm({ticketId,asset,link=false}:{ticketId:string;asset?:{id:string;tag:string};link?:boolean}) {
 const [state,action]=useActionState(changeAssetLink.bind(null,ticketId),{} as SaveState);
 if(!asset)return null;
 return <form action={action}><input type="hidden" name="assetId" value={asset.id}/><input type="hidden" name="mode" value={link?'link':'unlink'}/><SubmitButton className="button button-secondary button-small" pendingLabel="Saving…" aria-label={`${link?'Link':'Unlink'} asset ${asset.tag}`}>{link?'Link to ticket':'Unlink'}</SubmitButton>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>;
}
