'use client';
export default function AutomationError({retry}:{retry:()=>void}){return <section className="settings-card"><h1>Automations could not load</h1><p role="alert">Try again. This page load has not changed your automations.</p><button className="button button-primary" onClick={retry}>Try again</button></section>;}
