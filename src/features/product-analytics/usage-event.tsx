'use client';
import { useEffect, useRef } from 'react';
import { recordUsage } from './actions';
import type { PageEvent, UsageSurface } from './events';

// No browser storage, cookies, fingerprinting, query text or page URLs.
// Mounted only after an authorized page loads successfully and the user opts in.
export function UsageEvent({event,surface,targetId=null}:{event:PageEvent;surface:UsageSurface;targetId?:string|null}) {
  const sent=useRef(false);
  useEffect(()=>{
    const send=()=>{
      if(sent.current||document.visibilityState!=='visible')return;
      sent.current=true;
      try { void recordUsage(event,surface,targetId,crypto.randomUUID()).catch(()=>{}); } catch { /* Unsupported browser capabilities must not affect the page. */ }
    };
    send();document.addEventListener('visibilitychange',send);
    return ()=>document.removeEventListener('visibilitychange',send);
  },[event,surface,targetId]);
  return null;
}
