'use server';

import { redirect } from 'next/navigation';

import { validTimezone } from '@/features/timezones/model';
import { requireAssurance } from '@/lib/auth/assurance';
import { formString } from '@/lib/form-data';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function bootstrapOrganization(formData: FormData) {
  if (!validTimezone(formString(formData, 'timezone', 'UTC')))
    redirect('/account/unassigned?error=Choose a valid timezone.');
  const organizationName = formString(formData, 'organizationName', '').trim();
  const organizationSlug = formString(formData, 'organizationSlug', '').trim().toLowerCase();
  const administratorName = formString(formData, 'administratorName', '').trim();

  if (
    !organizationName ||
    !administratorName ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)
  ) {
    redirect(
      `/account/unassigned?${new URLSearchParams({ error: 'Enter a valid organization name, URL identifier, and your name.' })}`,
    );
  }

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (claimsError || !userId) redirect('/login');
  await requireAssurance(supabase);

  let error: { message: string } | null = null;
  try {
    const admin = createAdminClient();
    ({ error } = await admin.rpc('bootstrap_organization', {
      organization_name: organizationName,
      organization_slug: organizationSlug,
      administrator_name: administratorName,
      administrator_user_id: userId,
      organization_timezone: formString(formData, 'timezone', 'UTC'),
    }));
  } catch {
    redirect(
      `/account/unassigned?${new URLSearchParams({ error: 'Organization setup requires the Supabase server secret.' })}`,
    );
  }

  if (error)
    redirect(
      `/account/unassigned?${new URLSearchParams({ error: error.message.includes('organizations_slug_key') || error.message.includes('duplicate key') ? 'That workspace identifier is already in use. Choose another.' : 'We could not create your organization. Check the details and try again.' })}`,
    );

  redirect('/app');
}
