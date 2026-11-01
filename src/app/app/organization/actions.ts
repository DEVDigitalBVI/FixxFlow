'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { validTimezone } from '@/features/timezones/model';
import type { ActionResult } from '@/lib/action-result';
import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { createClient } from '@/lib/supabase/server';

export async function editOrganizationItem(form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator')
    return { error: 'Only administrators can manage organization settings.' };
  const kind = form.get('kind');
  if (kind !== 'departments' && kind !== 'locations')
    return { error: 'Choose a valid organization setting.' };
  const name = formString(form, 'name', '').trim();
  if (!name || name.length > 100) return { error: 'Enter a name between 1 and 100 characters.' };
  const optional = (key: string) => formString(form, key, '').trim() || null;
  const changes: {
    name: string;
    description?: string | null;
    city?: string | null;
    region?: string | null;
    country_code?: string | null;
    timezone?: string;
    parent_id?: string | null;
  } = { name };
  if (kind === 'departments') {
    changes.description = optional('description');
    if ((changes.description?.length ?? 0) > 2000)
      return { error: 'Keep the description within 2,000 characters.' };
  } else {
    if (form.has('parentId')) {
      changes.parent_id = optional('parentId');
      if (changes.parent_id && !isUuid(changes.parent_id))
        return {
          error: 'Choose a valid parent location.',
          fieldErrors: { parentId: 'Choose a parent location from the list.' },
        };
    }
    changes.city = optional('city');
    changes.region = optional('region');
    changes.country_code = optional('countryCode')?.toUpperCase() ?? null;
    changes.timezone = optional('timezone') ?? '';
    if (changes.country_code && !/^[A-Z]{2}$/.test(changes.country_code))
      return { error: 'Use a two-letter country code.' };
    if (!validTimezone(changes.timezone))
      return { error: 'Enter a valid named timezone, such as America/New_York.' };
  }
  const supabase = await createClient();
  const query =
    kind === 'departments'
      ? supabase.from('departments').update({ name, description: changes.description })
      : supabase.from('locations').update({
          name,
          city: changes.city,
          region: changes.region,
          country_code: changes.country_code,
          timezone: changes.timezone,
          ...(form.has('parentId') ? { parent_id: changes.parent_id } : {}),
        });
  const { data, error } = await query
    .eq('organization_id', viewer.organizationId)
    .eq('id', formString(form, 'id', ''))
    .eq('updated_at', formString(form, 'updatedAt', ''))
    .select('id')
    .maybeSingle();
  if (error?.code === '23505')
    return {
      error:
        kind === 'locations'
          ? 'That name already exists under this parent. Choose a different name.'
          : 'That name already exists. Choose a different name.',
    };
  if (kind === 'locations' && (error?.code === '23514' || error?.code === '23503'))
    return {
      error:
        'Choose an available parent outside this location’s own sublocations. Active locations need active parents, with at most eight levels.',
      fieldErrors: { parentId: 'This parent cannot be used. Review the hierarchy and try again.' },
    };
  if (error) return { error: 'Changes could not be saved. Your entries are preserved; try again.' };
  if (!data)
    return { error: 'This record changed or was removed. Reload the page before saving again.' };
  revalidatePath('/app/organization');
  revalidatePath('/app/people');
  revalidatePath('/app/tickets', 'layout');
  revalidatePath('/app/assets', 'layout');
  revalidatePath('/app/reports', 'layout');
  return { success: 'Changes saved.' };
}

function fail(message: string): never {
  redirect(`/app/organization?error=${encodeURIComponent(message)}`);
}

async function requireAdministrator() {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator')
    fail('Only administrators can manage organization settings.');
  return viewer;
}

export async function addDepartment(formData: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator')
    return { error: 'Only administrators can manage organization settings.' };
  const name = formString(formData, 'name', '').trim();
  const description = formString(formData, 'description', '').trim() || null;
  if (!name || name.length > 100)
    return {
      error: 'Review the department name.',
      fieldErrors: { name: 'Enter a name between 1 and 100 characters.' },
    };
  if ((description?.length ?? 0) > 2000)
    return {
      error: 'Review the description.',
      fieldErrors: { description: 'Keep the description within 2,000 characters.' },
    };
  const supabase = await createClient();
  const { error } = await supabase
    .from('departments')
    .insert({ organization_id: viewer.organizationId, name, description });
  if (error?.code === '23505')
    return {
      error: 'That department name already exists.',
      fieldErrors: { name: 'Choose a different name.' },
    };
  if (error)
    return { error: 'The department could not be added. Your entries are preserved; try again.' };
  revalidatePath('/app/organization');
  return { success: 'Department added.' };
}

export async function addLocation(formData: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator')
    return { error: 'Only administrators can manage organization settings.' };
  const name = formString(formData, 'name', '').trim();
  const city = formString(formData, 'city', '').trim() || null;
  const region = formString(formData, 'region', '').trim() || null;
  const countryCode = formString(formData, 'countryCode', '').trim().toUpperCase() || null;
  const timezone = formString(formData, 'timezone', viewer.organizationTimezone).trim();
  const parentId = formString(formData, 'parentId', '').trim() || null;
  const fieldErrors: Record<string, string> = {};
  if (!name || name.length > 100) fieldErrors.name = 'Enter a name between 1 and 100 characters.';
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode))
    fieldErrors.countryCode = 'Use a two-letter country code.';
  if (!validTimezone(timezone))
    fieldErrors.timezone = 'Enter a named timezone, such as America/Tortola.';
  if (parentId && !isUuid(parentId))
    fieldErrors.parentId = 'Choose a parent location from the list.';
  if (Object.keys(fieldErrors).length)
    return { error: 'Review the location details.', fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.from('locations').insert({
    organization_id: viewer.organizationId,
    name,
    city,
    region,
    country_code: countryCode,
    timezone,
    parent_id: parentId,
  });
  if (error?.code === '23505')
    return {
      error: 'That location name already exists under this parent.',
      fieldErrors: { name: 'Choose a different name for this parent location.' },
    };
  if (error?.code === '23503' || error?.code === '23514')
    return {
      error: 'Choose an active parent location with fewer than eight levels.',
      fieldErrors: {
        parentId: 'This parent is no longer available or has reached the nesting limit.',
      },
    };
  if (error)
    return { error: 'The location could not be added. Your entries are preserved; try again.' };
  revalidatePath('/app/organization');
  return { success: 'Location added.' };
}

export async function toggleDepartment(formData: FormData) {
  const viewer = await requireAdministrator();
  const id = formString(formData, 'id', '');
  const isActive = formData.get('isActive') === 'true';
  const supabase = await createClient();
  const { error } = await supabase
    .from('departments')
    .update({ is_active: !isActive })
    .eq('organization_id', viewer.organizationId)
    .eq('id', id);
  if (error) fail('The department status could not be changed.');
  revalidatePath('/app/organization');
}

export async function toggleLocation(formData: FormData) {
  const viewer = await requireAdministrator();
  const id = formString(formData, 'id', '');
  const isActive = formData.get('isActive') === 'true';
  const supabase = await createClient();
  const { error } = await supabase
    .from('locations')
    .update({ is_active: !isActive })
    .eq('organization_id', viewer.organizationId)
    .eq('id', id);
  if (error?.code === '23514')
    fail(
      'Deactivate or move active sublocations first. To reactivate a sublocation, activate its parents first.',
    );
  if (error) fail('The location status could not be changed.');
  revalidatePath('/app/organization');
}

async function deleteOrganizationItem(table: 'departments' | 'locations', formData: FormData) {
  const viewer = await requireAdministrator();
  const id = formString(formData, 'id', '');
  const label = table === 'departments' ? 'department' : 'location';
  if (!isUuid(id)) fail(`Choose a valid ${label}.`);
  if (formData.get('confirmDelete') !== id)
    fail(`Confirm that you want to permanently delete this ${label}.`);
  const supabase = await createClient();
  // Foreign keys enforce this atomically, including references added during the request.
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq('organization_id', viewer.organizationId)
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error?.code === '23503')
    fail(
      table === 'departments'
        ? 'This department is linked to people. Deactivate it to keep those links, or reassign the people before deleting it.'
        : 'This location has sublocations or is linked to people, tickets, or assets. Deactivate it to preserve linked records. Before deleting, move or remove its sublocations and reassign linked records.',
    );
  if (error) fail(`The ${label} could not be deleted. Please try again.`);
  if (!data)
    fail(`This ${label} is no longer available. Refresh the page to see the current list.`);
  revalidatePath('/app/organization');
  redirect(
    `/app/organization?success=${encodeURIComponent(`${label === 'department' ? 'Department' : 'Location'} deleted.`)}#${table}`,
  );
}

export async function deleteDepartment(formData: FormData) {
  return deleteOrganizationItem('departments', formData);
}

export async function deleteLocation(formData: FormData) {
  return deleteOrganizationItem('locations', formData);
}
