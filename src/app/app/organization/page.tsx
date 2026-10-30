import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { OrganizationCreateForm } from '@/features/administration/organization-create-form';
import { OrganizationItemActions } from '@/features/administration/organization-item-actions';
import { OrganizationItemEditor } from '@/features/administration/organization-item-editor';
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
      .from('locations')
      .select('id, name, city, region, country_code, timezone, is_active, updated_at')
      .eq('organization_id', viewer.organizationId)
      .order('name'),
  ]);
  return (
    <div className="page">
      <PageHeader
        title="Organization"
        eyebrow="Settings"
        description="Configure the departments and service locations used throughout FixxFlow."
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
      <section className="settings-card profile-card">
        <h2>Timezone</h2>
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
          <div className="management-list">
            {locations?.map((item) => (
              <div className="management-item" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.is_active ? 'Active' : 'Inactive'}</span>
                  <span>
                    {[item.city, item.region, item.country_code].filter(Boolean).join(', ') ||
                      item.timezone}
                  </span>
                </div>
                <OrganizationItemEditor kind="locations" item={item} />
                <OrganizationItemActions
                  id={item.id}
                  name={item.name}
                  active={item.is_active}
                  kind="location"
                  toggleAction={toggleLocation}
                  deleteAction={deleteLocation}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
