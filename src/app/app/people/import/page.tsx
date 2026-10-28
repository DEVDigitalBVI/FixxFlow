import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { BulkInvite } from '@/features/administration/bulk-invite';
import { requireViewer } from '@/lib/auth/viewer';

export const maxDuration = 60;
export default async function BulkInvitePage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  return (
    <div className="page people-page">
      <PageHeader
        title="Invite from CSV"
        description="Review people and roles, then send their invitations."
        back={{ href: '/app/people', label: 'Back to People' }}
      />
      <BulkInvite />
    </div>
  );
}
