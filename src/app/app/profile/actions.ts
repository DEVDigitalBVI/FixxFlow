'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

export async function updateProfile(formData: FormData) {
  const viewer = await requireViewer();
  const displayName = formString(formData, 'displayName', '').trim();
  const jobTitle = formString(formData, 'jobTitle', '').trim() || null;
  const phone = formString(formData, 'phone', '').trim() || null;
  if (
    formData.has('lookupLoadError') ||
    !formData.has('departmentId') ||
    !formData.has('locationId')
  )
    return {
      error: 'Choices could not load. Your entries are preserved; retry the lookup before saving.',
    };
  const departmentId = formString(formData, 'departmentId', '') || null;
  const locationId = formString(formData, 'locationId', '') || null;
  if (!displayName || displayName.length > 120) return { error: 'Enter a valid display name.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .update({
      display_name: displayName,
      job_title: jobTitle,
      phone,
      department_id: departmentId,
      location_id: locationId,
    })
    .eq('organization_id', viewer.organizationId)
    .eq('user_id', viewer.id)
    .select('user_id')
    .maybeSingle();
  if (error || !data) {
    const reference = reportServerError('profile.save', error);
    return {
      error: `Your profile could not be updated. Your entries are preserved. Reference: ${reference}`,
    };
  }
  revalidatePath('/app', 'layout');
  return { success: 'Profile updated.' };
}

export async function updateUsagePreference(formData: FormData) {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const { error } = await supabase
    .from('product_usage_preferences')
    .upsert({ user_id: viewer.id, enabled: formData.get('shareUsage') === 'on' });
  if (error)
    redirect('/app/profile?error=Your usage preference could not be saved. Please try again.');
  revalidatePath('/app', 'layout');
  redirect('/app/profile?success=Usage preference saved.');
}
