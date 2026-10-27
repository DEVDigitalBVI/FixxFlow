import { NavigationIcon } from '@/components/navigation/navigation-icon';

const steps = ['Create account', 'Verify email', 'Set up workspace'];
export function SignupProgress({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Signup progress">
      <p className="form-note">
        Step {current} of {steps.length} · {steps[current - 1]}
      </p>
      <ol className="signup-steps">
        {steps.map((label, index) => (
          <li key={label} aria-current={index + 1 === current ? 'step' : undefined}>
            <span
              className={
                index + 1 < current ? 'is-complete' : index + 1 === current ? 'is-current' : ''
              }
              aria-hidden="true"
            >
              {index + 1 < current ? <NavigationIcon name="check" size={16} /> : index + 1}
            </span>
            <span className="sr-only">
              {label}
              {index + 1 < current ? ' · Completed' : ''}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
