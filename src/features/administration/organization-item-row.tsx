import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

import { OrganizationItemActions } from './organization-item-actions';
import { OrganizationItemEditor } from './organization-item-editor';

type Props = {
  kind: 'department' | 'location';
  item: React.ComponentProps<typeof OrganizationItemEditor>['item'] & { is_active: boolean };
  metadata?: ReactNode;
  leadingAction?: ReactNode;
  children?: ReactNode;
  toggleAction: (form: FormData) => Promise<void>;
  deleteAction: (form: FormData) => Promise<void>;
};

/** One layout for current and future organization entries, regardless of content length. */
export function OrganizationItemRow({
  kind,
  item,
  metadata,
  leadingAction,
  children,
  toggleAction,
  deleteAction,
}: Props) {
  return (
    <div className={`management-item organization-entry organization-${kind}-item`}>
      <div className="organization-entry-identity">
        <strong>{item.path ?? item.name}</strong>
        <div className="organization-entry-meta">
          <Badge tone={item.is_active ? 'active' : 'muted'}>
            {item.is_active ? 'Active' : 'Inactive'}
          </Badge>
          {metadata && (
            <>
              <span aria-hidden="true">·</span>
              <span>{metadata}</span>
            </>
          )}
        </div>
        {kind === 'department' && (
          <p className="organization-entry-description muted">
            {item.description || 'No description'}
          </p>
        )}
      </div>
      <div className="organization-entry-controls">
        {leadingAction}
        <OrganizationItemActions
          editor={
            <OrganizationItemEditor
              kind={kind === 'department' ? 'departments' : 'locations'}
              item={item}
            />
          }
          id={item.id}
          name={item.path ?? item.name}
          active={item.is_active}
          kind={kind}
          toggleAction={toggleAction}
          deleteAction={deleteAction}
        />
      </div>
      {children}
    </div>
  );
}
