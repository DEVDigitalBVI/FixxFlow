'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { deletePeople } from '@/app/app/people/actions';
import { ActionForm } from '@/components/ui/action-form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SubmitButton } from '@/components/ui/submit-button';

import type { DeletablePerson } from './people-deletion-model';

const SelectionContext = createContext<{
  selected: string[];
  toggle: (id: string, checked: boolean) => void;
} | null>(null);

export function DeletePeopleControl({
  people,
  search = '',
  view = '',
  bulk = false,
}: {
  people: DeletablePerson[];
  search?: string;
  view?: string;
  bulk?: boolean;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  if (!people.length) return null;
  const count = people.length;
  const label = bulk ? `Delete selected (${count})` : 'Delete person';
  return (
    <details className="people-delete" ref={disclosure}>
      <summary className={buttonVariants({ variant: 'danger', size: 'small' })}>
        {label}
        {!bulk && <span className="sr-only"> {people[0].name}</span>}
      </summary>
      <ActionForm
        action={deletePeople}
        className="people-delete-confirmation stack"
        protectDraft={false}
        pendingMessage="Deleting people…"
      >
        <h4>
          {count === 1
            ? `Delete ${people[0].name} from this workspace?`
            : `Delete ${count} people from this workspace?`}
        </h4>
        <p>
          They will lose workspace access and disappear from People. Their login account, profiles,
          tickets, chats and equipment history will be retained. Existing assignments stay linked;
          reassign any outstanding work or equipment as needed.
        </p>
        <ul className="people-delete-names" aria-label="People to delete" tabIndex={0}>
          {people.map((person) => (
            <li key={person.id}>
              <strong>{person.name}</strong>
              {person.email && <span> · {person.email}</span>}
              <input type="hidden" name="personIds" value={person.id} />
            </li>
          ))}
        </ul>
        <input type="hidden" name="q" value={search} />
        <input type="hidden" name="view" value={view} />
        <label className="people-delete-acknowledgement">
          <Checkbox name="confirmDelete" value="yes" required />I confirm deletion of{' '}
          {count === 1 ? people[0].name : `these ${count} people`} from this workspace.
        </label>
        <div className="people-delete-actions">
          <SubmitButton variant="danger" pendingLabel="Deleting…">
            {count === 1 ? 'Delete person' : `Delete ${count} people`}
          </SubmitButton>
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              if (!disclosure.current) return;
              disclosure.current.open = false;
              disclosure.current.querySelector('summary')?.focus();
            }}
          >
            Cancel
          </Button>
        </div>
      </ActionForm>
    </details>
  );
}

export function PeopleSelection({
  people,
  search,
  view,
  children,
}: {
  people: DeletablePerson[];
  search: string;
  view: string;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const chosen = people.filter((person) => selected.includes(person.id));
  const all = people.length > 0 && chosen.length === people.length;
  useEffect(() => {
    if (allCheckbox.current) allCheckbox.current.indeterminate = chosen.length > 0 && !all;
  }, [chosen.length, all]);
  return (
    <SelectionContext
      value={{
        selected,
        toggle: (id, checked) =>
          setSelected((current) =>
            checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
          ),
      }}
    >
      {people.length > 0 && (
        <div className="people-selection" aria-label="People selection">
          <label className="people-select-all">
            <Checkbox
              ref={allCheckbox}
              checked={all}
              onChange={(event) =>
                setSelected(event.target.checked ? people.map((person) => person.id) : [])
              }
            />
            Select all eligible people on this page
          </label>
          <span role="status">{chosen.length} selected</span>
          {chosen.length > 0 && (
            <Button
              type="button"
              variant="quiet"
              size="small"
              onClick={() => {
                setSelected([]);
                allCheckbox.current?.focus();
              }}
            >
              Clear selection
            </Button>
          )}
          <DeletePeopleControl
            key={chosen.map((person) => person.id).join(',')}
            people={chosen}
            search={search}
            view={view}
            bulk
          />
        </div>
      )}
      {children}
    </SelectionContext>
  );
}

export function PersonSelection({ id, name }: { id: string; name: string }) {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <label className="person-select">
      <Checkbox
        checked={selection.selected.includes(id)}
        onChange={(event) => selection.toggle(id, event.target.checked)}
      />
      <span className="sr-only">Select {name} for deletion</span>
    </label>
  );
}
