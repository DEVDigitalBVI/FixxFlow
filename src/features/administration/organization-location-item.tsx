import { Badge } from '@/components/ui/badge';

import { OrganizationCreateForm } from './organization-create-form';
import { OrganizationItemActions } from './organization-item-actions';
import { OrganizationItemEditor } from './organization-item-editor';

type LocationItem = {
  id: string;
  name: string;
  path: string;
  parent_id: string | null;
  depth: number;
  city: string | null;
  region: string | null;
  country_code: string | null;
  timezone: string;
  is_active: boolean;
  updated_at: string;
};

export function OrganizationLocationItem({
  item,
  addAction,
  toggleAction,
  deleteAction,
}: {
  item: LocationItem;
  addAction: React.ComponentProps<typeof OrganizationCreateForm>['action'];
  toggleAction: (form: FormData) => Promise<void>;
  deleteAction: (form: FormData) => Promise<void>;
}) {
  return (
    <div className="management-item organization-location-item">
      <div className="organization-location-identity">
        <strong>{item.path}</strong>
        <div className="organization-location-meta">
          <Badge tone={item.is_active ? 'active' : 'muted'}>
            {item.is_active ? 'Active' : 'Inactive'}
          </Badge>
          <span aria-hidden="true">·</span>
          <span>
            {[item.city, item.region, item.country_code].filter(Boolean).join(', ') ||
              item.timezone}
          </span>
        </div>
      </div>
      <div className="organization-location-controls">
        {item.is_active && item.depth < 8 && (
          <details className="settings-editor organization-sublocation">
            <summary>
              Add sublocation<span className="sr-only"> to {item.path}</span>
            </summary>
            <OrganizationCreateForm
              kind="location"
              action={addAction}
              timezone={item.timezone}
              parentId={item.id}
            />
          </details>
        )}
        <OrganizationItemEditor kind="locations" item={item} />
        <OrganizationItemActions
          id={item.id}
          name={item.path}
          active={item.is_active}
          kind="location"
          toggleAction={toggleAction}
          deleteAction={deleteAction}
        />
      </div>
    </div>
  );
}
