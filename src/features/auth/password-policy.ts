export const PASSWORD_MIN_LENGTH = 8;
// Match Supabase's lower_upper_letters_digits_symbols policy exactly.
const symbols = '!@#$%^&*()_+-=[]{};\':"\\|,.<>/?`~';
export const passwordRequirements = [
  {
    id: 'length',
    label: 'At least 8 characters',
    test: (value: string) => [...value].length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'uppercase',
    label: 'An uppercase letter (A–Z)',
    test: (value: string) => /[A-Z]/.test(value),
  },
  {
    id: 'lowercase',
    label: 'A lowercase letter (a–z)',
    test: (value: string) => /[a-z]/.test(value),
  },
  { id: 'number', label: 'A number (0–9)', test: (value: string) => /[0-9]/.test(value) },
  {
    id: 'symbol',
    label: 'A symbol, such as !, @ or #',
    test: (value: string) => [...value].some((character) => symbols.includes(character)),
  },
];
export function passwordMeetsPolicy(value: string) {
  return passwordRequirements.every((rule) => rule.test(value));
}
export function passwordPolicyMessage(value: string) {
  return passwordRequirements
    .filter((rule) => !rule.test(value))
    .map((rule) => rule.label)
    .join('; ');
}
