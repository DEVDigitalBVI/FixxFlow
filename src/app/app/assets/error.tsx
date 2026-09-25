'use client';
export default function AssetsError({ retry }: { retry: () => void }) { return <div className="page"><h1>Assets could not load</h1><p role="alert">Please try again. Your assets have not changed.</p><button className="button button-primary" onClick={retry}>Try again</button></div>; }
