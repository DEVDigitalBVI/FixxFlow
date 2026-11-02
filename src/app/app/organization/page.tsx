import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { OrganizationCreateForm } from '@/features/administration/organization-create-form';
import { OrganizationItemActions } from '@/features/administration/organization-item-actions';
import { OrganizationItemEditor } from '@/features/administration/organization-item-editor';
import { OrganizationLocationList } from '@/features/administration/organization-location-item';
import { TimezoneSelect } from '@/features/timezones/select';
import { TimezoneSettingsForm } from '@/features/timezones/settings-form';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import {
  addDepartment,
  addLocation,
  deleteDepartment,
  deleteLocation,
  toggleDepartment,
  toggleLocation,
} from './actions';

type Props = { searchParams: Promise<{ error?: string; success?: string }> };
export default async function OrganizationPage({ searchParams }: Props) {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  const message = await searchParams;
  const supabase = await createClient();
  const [
    { data: departments, error: departmentsError },
    { data: locations, error: locationsError },
  ] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name, description, is_active, updated_at')
      .eq('organization_id', viewer.organizationId)
      .order('name'),
    supabase
      .from('location_paths')
      .select(
        'id, name, path, parent_id, depth, city, region, country_code, timezone, is_active, updated_at',
      )
      .eq('organization_id', viewer.organizationId)
      .order('path'),
  ]);
  return (
    <div className="page organization-page">
      <PageHeader
        title="Organization"
        eyebrow="Settings"
        description="Manage the business departments and physical locations used in people, requests and reports."
        back={{ href: '/app/administration', label: 'Back to settings' }}
      />
      {message.success && (
        <Alert tone="success" className="page-alert" role="status">
          {message.success}
        </Alert>
      )}
      {message.error && (
        <Alert tone="error" className="page-alert" role="alert">
          {message.error}
        </Alert>
      )}
      <section className="organization-guidance" aria-labelledby="organization-guidance-title">
        <h2 id="organization-guidance-title">How departments and locations work</h2>
        <p>
          These are separate lists, not a hierarchy. A department can work across several locations,
          and a location can contain several departments. For example, Finance staff might work at
          both Head office and a branch office.
        </p>
        <p>
          Create the entries below, then assign each person a department and location in{' '}
          <Link href="/app/people">People → Manage → Profile details</Link>. These choices describe
          the person; they do not assign an IT technician to their requests.
        </p>
      </section>
      <section
        className="settings-card organization-timezone"
        aria-labelledby="organization-timezone-title"
      >
        <h2 id="organization-timezone-title">Timezone</h2>
        <p className="muted">
          Reports and shared calendar days use this timezone. Existing deadlines keep their saved
          instant.
        </p>
        <TimezoneSettingsForm scope="organization" initial={viewer.organizationTimezone}>
          <TimezoneSelect value={viewer.organizationTimezone} />
        </TimezoneSettingsForm>
      </section>
      <div className="settings-grid">
        <section id="departments" className="settings-card">
          <h2>Departments</h2>
          <p className="muted">
            Group people by business function, such as Finance, HR or Operations. Reports can use
            the requester’s department to show where support demand comes from.
          </p>
          <details className="progressive-section">
            <summary>Add department</summary>
            <OrganizationCreateForm kind="department" action={addDepartment} />
          </details>
          {departmentsError ? (
            <Alert as="p" tone="error" role="alert">
              Departments could not be loaded.{' '}
              <Link
                className={buttonVariants({ variant: 'secondary' })}
                href="/app/organization#departments"
              >
                Try again
              </Link>
              .
            </Alert>
          ) : (
            !departments?.length && <EmptyState as="p">No departments yet.</EmptyState>
          )}
          <div className="management-list">
            {departments?.map((item) => (
              <div className="management-item" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.is_active ? 'Active' : 'Inactive'}</span>
                  <span>{item.description ?? 'No description'}</span>
                </div>
                <OrganizationItemEditor kind="departments" item={item} />
                <OrganizationItemActions
                  id={item.id}
                  name={item.name}
                  active={item.is_active}
                  kind="department"
                  toggleAction={toggleDepartment}
                  deleteAction={deleteDepartment}
                />
              </div>
            ))}
          </div>
        </section>
        <section id="locations" className="settings-card">
          <h2>Locations</h2>
          <p className="muted">
            List the places you support, such as Head office, a branch or a warehouse. Assign
            locations to people, tickets and equipment to show where support is needed.
          </p>
          <p className="muted">
            Nest places using Parent location, for example Head office / First floor / Room 101.
            Choose the most specific place when assigning a location. Names can repeat under
            different parents, with up to eight levels. Deactivate sublocations before their parent.
          </p>
          <details className="progressive-section">
            <summary>Add location</summary>
            <OrganizationCreateForm
              kind="location"
              action={addLocation}
              timezone={viewer.organizationTimezone}
            />
          </details>
          {locationsError ? (
            <Alert as="p" tone="error" role="alert">
              Locations could not be loaded.{' '}
              <Link
                className={buttonVariants({ variant: 'secondary' })}
                href="/app/organization#locations"
              >
                Try again
              </Link>
              .
            </Alert>
          ) : (
            !locations?.length && <EmptyState as="p">No locations yet.</EmptyState>
          )}
          <OrganizationLocationList
            items={locations ?? []}
            addAction={addLocation}
            toggleAction={toggleLocation}
            deleteAction={deleteLocation}
          />
        </section>
      </div>
    </div>
  );
}
