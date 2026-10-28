export type CompanyProvider = 'google' | 'azure';
export function companyProviders(environment: Record<string, string | undefined>) {
  return [
    {
      provider: 'azure' as const,
      label: 'Microsoft',
      enabled: environment.AUTH_MICROSOFT_ENABLED === 'true',
    },
    {
      provider: 'google' as const,
      label: 'Google',
      enabled: environment.AUTH_GOOGLE_ENABLED === 'true',
    },
  ].filter((item) => item.enabled);
}
export function companyCallback(environment: Record<string, string | undefined>): string | null {
  try {
    const base = new URL(environment.NEXT_PUBLIC_SITE_URL ?? '');
    if (
      base.username ||
      base.password ||
      !(
        base.protocol === 'https:' ||
        (environment.NODE_ENV !== 'production' &&
          base.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(base.hostname))
      )
    )
      return null;
    return new URL('/auth/callback', base.origin).toString();
  } catch {
    return null;
  }
}

export function companyAuthorizeUrl(candidate: string, projectUrl: string): string | null {
  try {
    const target = new URL(candidate),
      project = new URL(projectUrl);
    return target.origin === project.origin && target.pathname === '/auth/v1/authorize'
      ? target.toString()
      : null;
  } catch {
    return null;
  }
}
