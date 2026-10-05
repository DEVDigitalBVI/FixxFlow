'use client';
export default function AdministrationError({ retry }: { retry: () => void }) { return <div className="page"><h1>Administration could not load</h1><p role="alert">Please try again. Your settings have not changed.</p><button className="button button-primary" onClick={retry}>Try again</button></div>; }
