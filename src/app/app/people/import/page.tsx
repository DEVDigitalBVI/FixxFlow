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
        description="1. Choose a CSV. 2. Review names, email addresses and roles. 3. Confirm and send invitations. Selecting a file does not send email."
        back={{ href: '/app/people', label: 'Back to people' }}
      />
      <BulkInvite />
    </div>
  );
}
