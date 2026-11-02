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

type LocationActions = {
  addAction: React.ComponentProps<typeof OrganizationCreateForm>['action'];
  toggleAction: (form: FormData) => Promise<void>;
  deleteAction: (form: FormData) => Promise<void>;
};

export function OrganizationLocationList({
  items,
  ...actions
}: LocationActions & { items: LocationItem[] }) {
  const ids = new Set(items.map((item) => item.id));
  const children = new Map<string | null, LocationItem[]>();
  for (const item of items) {
    const parent = item.parent_id && ids.has(item.parent_id) ? item.parent_id : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(item);
    children.set(parent, siblings);
  }

  function renderLocations(parent: LocationItem | null) {
    const entries = children.get(parent?.id ?? null);
    if (!entries?.length) return null;
    return (
      <ul
        className={
          parent ? 'organization-location-children' : 'management-list organization-location-list'
        }
        aria-label={parent ? `Sublocations of ${parent.path}` : 'Locations'}
      >
        {entries.map((item) => (
          <li key={item.id}>
            <OrganizationLocationItem item={item} {...actions}>
              {renderLocations(item)}
            </OrganizationLocationItem>
          </li>
        ))}
      </ul>
    );
  }

  return renderLocations(null);
}

export function OrganizationLocationItem({
  item,
  addAction,
  toggleAction,
  deleteAction,
  children,
}: LocationActions & {
  item: LocationItem;
  children?: React.ReactNode;
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
      {children}
    </div>
  );
}
