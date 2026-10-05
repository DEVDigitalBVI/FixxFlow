import { ImportAutomation } from '@/features/automation/import-automation';
import { AutomationHeader } from '@/features/automation/page-parts';
import { requireAutomationAdmin } from '@/features/automation/ui-service';

export default async function ImportAutomationPage() {
  await requireAutomationAdmin();
  return <><AutomationHeader title="Import Automation" description="Bring a workflow into your organization. Review, map and test before saving."/><ImportAutomation/></>;
}
