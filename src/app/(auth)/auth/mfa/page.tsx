import { MfaChallenge } from "@/features/auth/mfa-challenge";
export default function MfaPage() { return <section className="auth-card" aria-labelledby="mfa-heading"><h1 id="mfa-heading">Verify it’s you</h1><p className="auth-intro">Enter the six-digit code from your authenticator app.</p><MfaChallenge /></section>; }
