export type AccountAuthenticationPolicy = { mfa_required: boolean; has_verified_factor: boolean };
export function readAccountPolicy(data: unknown): AccountAuthenticationPolicy | null {
  if (
    !Array.isArray(data) ||
    data.length !== 1 ||
    !data[0] ||
    typeof data[0].mfa_required !== 'boolean' ||
    typeof data[0].has_verified_factor !== 'boolean'
  )
    return null;
  return data[0];
}
