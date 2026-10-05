import { signOut } from "../../actions";
export default function InactivePage() { return <section className="auth-card"><h1>Account inactive</h1><p className="auth-intro">Your organization access is inactive. Contact an administrator if you believe this is a mistake.</p><form action={signOut}><button className="button button-secondary" type="submit">Sign out</button></form></section>; }
