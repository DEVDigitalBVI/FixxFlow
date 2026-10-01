import { AutomationBuilder } from '@/features/automation/builder';
import { AutomationHeader } from '@/features/automation/page-parts';
import { requireAutomationAdmin } from '@/features/automation/ui-service';
export default async function NewAutomationPage(){await requireAutomationAdmin();return <><AutomationHeader title="Create Automation" description="Choose when to act, what must match and what happens next."/><AutomationBuilder/></>;}
