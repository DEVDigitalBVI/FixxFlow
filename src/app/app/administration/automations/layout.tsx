import type { ReactNode } from 'react';
import { requireAutomationAdmin } from '@/features/automation/ui-service';
export default async function AutomationLayout({children}:{children:ReactNode}) {
  await requireAutomationAdmin();
  return <div className="page automation-page"><aside className="alert alert-info" aria-label="Automation processing">{process.env.AUTOMATION_PROCESSING_ENABLED!=='true'?<><strong>Automation processing is off.</strong> You can save, test and enable rules. They will remain idle until processing is activated separately.</>:<>Rule enablement and global processing are separate. Activation is managed outside this screen.</>}</aside>{children}</div>;
}
