'use server';

import { revalidatePath } from 'next/cache';

import {
  validateImport,
  type ImportIssue,
  type ImportResult,
} from '@/features/assets/import-model';
import { assetInput } from '@/features/assets/model';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export async function importAssets(
  input: unknown,
  mode: 'preview' | 'save',
  options: { updateExisting?: boolean; versions?: Record<string, string> } = {},
): Promise<ImportResult> {
  if (
    !options ||
    typeof options !== 'object' ||
    (options.updateExisting !== undefined && typeof options.updateExisting !== 'boolean')
  )
    return { error: 'Choose an import mode.' };
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can import assets.' };
  if (!['preview', 'save'].includes(mode)) return { error: 'Choose preview or import.' };
  const result = validateImport(input);
  if (result.error || result.issues?.length || !result.rows) return result;
  const rows = result.rows;
  const db = await createClient();
  const org = viewer.organizationId;
  const issues: ImportIssue[] = [];
  const tags = new Set<string>();
  const versions: Record<string, string> = {};
  const people = new Map<string, string[]>();
  const locations = new Map<string, string[]>();
  const active = new Set<string>();
  // PostgREST `in` filters stay short; chunks for one lookup run together.
  const lookup = async <T>(
    values: string[],
    query: (group: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ) => {
    const groups = Array.from({ length: Math.ceil(values.length / 50) }, (_, i) =>
      values.slice(i * 50, i * 50 + 50),
    );
    const results = await Promise.all(groups.map(query));
    if (results.some((r) => r.error)) throw Error();
    return results.flatMap((r) => r.data ?? []);
  };
  try {
    const emails = [...new Set(rows.map((r) => r.assigned_email).filter(Boolean))];
    const names = [...new Set(rows.map((r) => r.location).filter(Boolean))];
    // Existing tags, people (then their memberships) and locations are independent.
    const [existing, places] = await Promise.all([
      lookup(
        rows.map((r) => r.tag),
        (group) =>
          db.from('assets').select('tag,revision').eq('organization_id', org).in('tag', group),
      ),
      lookup(names, (group) =>
        db
          .from('locations')
          .select('id,name')
          .eq('organization_id', org)
          .eq('is_active', true)
          .in('name', group),
      ),
      (async () => {
        const found = await lookup(emails, (group) =>
          db.from('profiles').select('user_id,email').eq('organization_id', org).in('email', group),
        );
        for (const person of found)
          if (person.email)
            people.set(person.email, [...(people.get(person.email) ?? []), person.user_id]);
        const members = await lookup([...people.values()].flat(), (group) =>
          db
            .from('organization_memberships')
            .select('user_id')
            .eq('organization_id', org)
            .eq('status', 'active')
            .in('user_id', group),
        );
        for (const person of members) active.add(person.user_id);
      })(),
    ]);
    for (const asset of existing) {
      tags.add(asset.tag);
      versions[asset.tag] = String(asset.revision);
    }
    for (const location of places)
      locations.set(location.name, [...(locations.get(location.name) ?? []), location.id]);
  } catch {
    return {
      rows,
      error:
        'The inventory and reference checks could not finish. Your preview is preserved. Try again.',
    };
  }
  const records = rows.map((row) => {
    if (tags.has(row.tag) && !options.updateExisting)
      issues.push({
        row: row.row,
        message: 'This asset tag already exists. Existing assets are not changed by imports.',
      });
    const matches = (people.get(row.assigned_email) ?? []).filter((id) => active.has(id));
    const places = locations.get(row.location) ?? [];
    if (row.assigned_email && matches.length !== 1)
      issues.push({
        row: row.row,
        message: 'Employee email must match exactly one active employee in this organization.',
      });
    if (row.location && places.length !== 1)
      issues.push({
        row: row.row,
        message: 'Location must match exactly one active location name in this organization.',
      });
    const form = new FormData();
    for (const [key, value] of Object.entries(row)) form.set(key, String(value));
    form.set('assigned_user_id', row.assigned_email && matches.length === 1 ? matches[0] : '');
    form.set('location_id', row.location && places.length === 1 ? places[0] : '');
    const parsed = assetInput(form);
    if (parsed.error) issues.push({ row: row.row, message: parsed.error });
    return { ...parsed.data!, organization_id: org };
  });
  if (issues.length || mode === 'preview') return { rows, issues, versions };
  if (options.updateExisting) {
    if (!options.versions || typeof options.versions !== 'object')
      return { rows, error: 'Preview this file before updating assets.' };
    const result = await db.rpc('import_asset_updates', {
      org,
      records,
      expected: options.versions,
    });
    if (result.error)
      return {
        rows,
        error:
          result.error.code === '40001'
            ? 'An asset changed since preview. Preview the file again. Nothing was saved.'
            : 'Import could not be confirmed. Check assets and preview again before retrying.',
      };
    revalidatePath('/app/assets', 'layout');
    revalidatePath('/app/people', 'layout');
    return {
      success: `${rows.length} assets saved (${Object.keys(versions).length} updated, ${rows.length - Object.keys(versions).length} created).`,
    };
  }
  // One INSERT statement: any duplicate, reference, or RLS failure rolls back the entire batch.
  const { error } = await db.from('assets').insert(records);
  if (error)
    return {
      error:
        error.code === '23505'
          ? 'An asset tag already exists or was added after preview. No rows from this attempt were imported. Check inventory and preview again.'
          : 'Import could not be confirmed. Check inventory before retrying. Any saved batch is complete, and unique tags prevent duplicate assets.',
    };
  revalidatePath('/app/assets', 'layout');
  return { success: `${rows.length} asset${rows.length === 1 ? '' : 's'} imported successfully.` };
}
