import type { AppRole } from '@/types/database';

export const PEOPLE_DELETE_LIMIT = 25;

export function canDeletePerson(viewerRole: AppRole, targetRole: AppRole, isSelf: boolean) {
  return (
    !isSelf &&
    (viewerRole === 'administrator' || (viewerRole === 'technician' && targetRole === 'end_user'))
  );
}

export type DeletablePerson = { id: string; name: string; email: string };
