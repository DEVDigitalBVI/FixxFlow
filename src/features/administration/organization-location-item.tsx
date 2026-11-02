import { OrganizationCreateForm } from './organization-create-form';
import { OrganizationItemRow } from './organization-item-row';

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
    <OrganizationItemRow
      kind="location"
      item={item}
      metadata={
        [item.city, item.region, item.country_code].filter(Boolean).join(', ') || item.timezone
      }
      toggleAction={toggleAction}
      deleteAction={deleteAction}
      leadingAction={
        item.is_active &&
        item.depth < 8 && (
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
        )
      }
    >
      {children}
    </OrganizationItemRow>
  );
}
