/** Served only as the response to a same-origin native POST: no app state is hydrated. */
export function logoutDocument(userId: string | null, nonce: string, revoked: boolean) {
  const target = revoked
    ? '/login'
    : '/login?error=Signed%20out%20on%20this%20device.%20Server%20revocation%20could%20not%20be%20confirmed.';
  const payload = JSON.stringify({ userId, target }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Signing out · FixxFlow</title></head><body><main><h1>Signing out</h1><p role="status">Clearing this device’s workspace data…</p><noscript><p>You are signed out on this device. <a href="/login">Return to sign in</a>.</p></noscript></main><script nonce="${nonce}">
(async()=>{
 const state=${payload};
 try{const channel=new BroadcastChannel('fixxflow-session');channel.postMessage({type:'signed-out',userId:state.userId});channel.close();}catch{}
 try{localStorage.clear();}catch{}try{sessionStorage.clear();}catch{}
 const tasks=[];
 try{if('caches' in window)tasks.push(caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key)))));}catch{}
 try{if('indexedDB' in window&&indexedDB.databases)tasks.push(indexedDB.databases().then(rows=>Promise.all(rows.filter(row=>row.name).map(row=>new Promise(resolve=>{const request=indexedDB.deleteDatabase(row.name);request.onsuccess=request.onerror=request.onblocked=resolve;})))));}catch{}
 try{if(navigator.serviceWorker)tasks.push(navigator.serviceWorker.getRegistrations().then(rows=>Promise.all(rows.map(row=>row.unregister()))));}catch{}
 await Promise.race([Promise.allSettled(tasks),new Promise(resolve=>setTimeout(resolve,2000))]);
 window.location.replace(state.target);
})();</script></body></html>`;
}
