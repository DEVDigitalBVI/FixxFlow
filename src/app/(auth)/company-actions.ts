'use server';

import { redirect } from 'next/navigation';

import {
  companyAuthorizeUrl,
  companyCallback,
  companyProviders,
} from '@/features/auth/company-sign-in';
import { getSupabaseEnvironment } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export async function companySignIn(form: FormData) {
  const provider = companyProviders(process.env).find(
    (item) => item.provider === form.get('provider'),
  )?.provider;
  const redirectTo = companyCallback(process.env);
  if (!provider || !redirectTo)
    redirect('/login?error=Company%20sign-in%20is%20not%20available%20yet.');
  const db = await createClient();
  const { data, error } = await db.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      scopes: provider === 'azure' ? 'email' : undefined,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error || !data.url)
    redirect('/login?error=Company%20sign-in%20could%20not%20start.%20Please%20try%20again.');
  const target = companyAuthorizeUrl(data.url, getSupabaseEnvironment().url);
  if (!target) redirect('/login?error=Company%20sign-in%20could%20not%20start.');
  redirect(target);
}
