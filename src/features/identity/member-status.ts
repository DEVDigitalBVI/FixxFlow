import type { BadgeTone } from '@/components/ui/badge';

export type MemberAccountStatus = 'invited' | 'active' | 'inactive';

export const memberStatusPresentation: Record<
  MemberAccountStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  invited: {
    label: 'Invited',
    tone: 'info',
    description: 'Invitation sent · Account setup pending',
  },
  active: { label: 'Active', tone: 'success', description: '' },
  inactive: { label: 'Inactive', tone: 'muted', description: '' },
};

export function isMemberAccountStatus(value: string): value is MemberAccountStatus {
  return Object.hasOwn(memberStatusPresentation, value);
}
