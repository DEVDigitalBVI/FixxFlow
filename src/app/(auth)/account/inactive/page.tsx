import { Button } from '@/components/ui/button';

export default function InactivePage() {
  return (
    <section className="auth-card">
      <h1>Account inactive</h1>
      <p className="auth-intro">
        Your organization access is inactive. Contact an administrator if you believe this is a
        mistake.
      </p>
      <form action="/auth/sign-out" method="post">
        <Button variant="secondary" type="submit">
          Sign out
        </Button>
      </form>
    </section>
  );
}
