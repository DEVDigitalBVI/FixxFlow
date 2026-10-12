'use client';
export default function InventoryError({retry}:{retry:()=>void}){return <div className="page"><h1>Inventory could not load</h1><p role="alert">Try again to load the latest stock and request progress.</p><button className="button button-primary" onClick={retry}>Try again</button></div>;}
