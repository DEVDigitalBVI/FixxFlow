import { saveClassification } from '@/app/app/administration/actions';
import { ActionForm } from '@/components/ui/action-form';
import { Input, NativeSelect } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';

type Item = {
  id: string;
  name: string;
  is_active: boolean;
  updated_at: string;
  default_team_id?: string | null;
};
export function ClassificationEditor({
  kind,
  item,
  categoryId,
  teams = [],
}: {
  kind: 'teams' | 'ticket_categories' | 'ticket_subcategories';
  item?: Item;
  categoryId?: string;
  teams?: { id: string; name: string; is_active: boolean }[];
}) {
  const label =
    kind === 'teams' ? 'team' : kind === 'ticket_categories' ? 'category' : 'subcategory';
  const key = item?.id ?? `new-${kind}-${categoryId ?? ''}`;
  return (
    <ActionForm action={saveClassification} className="stack" resetOnSuccess={!item}>
      <input type="hidden" name="kind" value={kind} />
      {item && (
        <>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="updatedAt" value={item.updated_at} />
        </>
      )}
      {categoryId && <input type="hidden" name="categoryId" value={categoryId} />}
      <div className="field">
        <label htmlFor={`name-${key}`}>{item ? `Name of ${label}` : `New ${label} name`}</label>
        <Input id={`name-${key}`} name="name" required maxLength={100} defaultValue={item?.name} />
      </div>
      {item ? (
        <div className="field">
          <label htmlFor={`active-${key}`}>Availability</label>
          <NativeSelect id={`active-${key}`} name="isActive" defaultValue={String(item.is_active)}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </NativeSelect>
        </div>
      ) : (
        <input type="hidden" name="isActive" value="true" />
      )}
      {kind === 'ticket_categories' && (
        <div className="field">
          <label htmlFor={`team-${key}`}>Default team for new tickets</label>
          <NativeSelect
            id={`team-${key}`}
            name="defaultTeamId"
            defaultValue={item?.default_team_id ?? ''}
            aria-describedby={`routing-${key}`}
          >
            <option value="">No default · leave unassigned</option>
            {teams
              .filter((team) => team.is_active || team.id === item?.default_team_id)
              .map((team) => (
                <option key={team.id} value={team.id} disabled={!team.is_active}>
                  {team.name}
                  {team.is_active ? '' : ' (inactive — choose another team)'}
                </option>
              ))}
          </NativeSelect>
          <small className="muted" id={`routing-${key}`}>
            Applies to new tickets only. Staff can override routing. Inactive teams receive no
            automatic assignments.
          </small>
        </div>
      )}
      <SubmitButton variant={item ? 'secondary' : 'primary'}>
        {item ? `Save ${label}` : `Add ${label}`}
      </SubmitButton>
    </ActionForm>
  );
}
