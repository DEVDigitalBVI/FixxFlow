import Link from 'next/link';
import {redirect} from 'next/navigation';
import {platformIdentity} from '@/lib/auth/platform';
import {MfaEnrollment} from '@/features/auth/mfa-enrollment';
import {MfaChallenge} from '@/features/auth/mfa-challenge';
export default async function PlatformAccessPage(){const owner=await platformIdentity();if(owner.access==='ready')redirect('/platform');return <div className="page page-narrow"><header className="page-header"><div><h1>Secure your owner account</h1><p>Platform access requires an authenticator and a verified session.</p></div></header><section className="settings-card stack">{owner.access==='verify'?<MfaChallenge destination="/platform"/>:<><MfaEnrollment/><Link className="button button-primary" href="/platform">Continue after enabling your authenticator</Link></>}</section></div>;}
