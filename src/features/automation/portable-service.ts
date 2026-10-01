import 'server-only';
import { getAutomation } from './admin-service';
import { automationLabels, requireAutomationAdmin } from './ui-service';
import { exportPortablePackage, portableFilename } from './portable';

/** Session/MFA/tenant-scoped reads only. No service-role client or audit writes. */
export async function exportAutomation(ruleId: string) {
  await requireAutomationAdmin();
  const result = await getAutomation(ruleId);
  if (!result.ok) throw new Error('Automation could not be exported.');
  const definition = result.value.rule.definition;
  const pkg = exportPortablePackage(definition, await automationLabels(definition));
  return { filename: portableFilename(definition.name), package: pkg };
}
