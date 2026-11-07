import Link from 'next/link';
import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { requireAutomationAdmin } from '@/features/automation/ui-service';

export default async function AutomationLayout({ children }: { children: ReactNode }) {
  await requireAutomationAdmin();
  return (
    <div className="page automation-page">
      <Alert as="aside" tone="info" aria-label="Automation processing">
        {process.env.AUTOMATION_PROCESSING_ENABLED !== 'true' ? (
          <>
            <strong>Automation processing is off.</strong> You can save, test and enable rules. They
            will remain idle until the deployment administrator activates processing. Enabling a
            rule does not start the processing service.{' '}
            <Link href="/app/support">Contact FixxFlow support for activation</Link>.
          </>
        ) : (
          <>
            Rule enablement and global processing are separate. Activation is managed outside this
            screen.
          </>
        )}
      </Alert>
      {children}
    </div>
  );
}
