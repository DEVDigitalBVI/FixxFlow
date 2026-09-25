'use client';
export default function AdministrationError({ reset }: { reset: () => void }) { return <div className="page"><h1>Administration could not load</h1><p role="alert">Please try again. Your settings have not changed.</p><button className="button button-primary" onClick={reset}>Try again</button></div>; }
