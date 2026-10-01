'use server';
import { revalidatePath } from 'next/cache';
import { createAutomation, updateAutomation, duplicateAutomation, setAutomationEnabled, archiveAutomation } from '@/features/automation/admin-service';
import { testAutomation } from '@/features/automation/dry-run-service';
import { automationChoices, automationEvents, automationResultLabels } from '@/features/automation/ui-service';
import { automationPath } from '@/features/automation/ui-model';
import type { ActionResult } from '@/lib/action-result';

export async function saveAutomationDraft(id: string | null, version: number | null, definition: unknown) {
  const result = id ? await updateAutomation(id,version!,definition) : await createAutomation(definition);
  if(result.ok) revalidatePath(automationPath,'layout');
  return result;
}
export async function manageAutomation(form: FormData): Promise<ActionResult> {
  const id=String(form.get('id')??''), version=Number(form.get('version')), operation=form.get('operation');
  if(!['duplicate','enable','disable','archive'].includes(String(operation))) return {error:'Choose an available action.'};
  if(['enable','archive'].includes(String(operation)) && form.get('confirmation')!==id) return {error:'Confirm this change before continuing.'};
  const result=operation==='duplicate' ? await duplicateAutomation(id,version,String(form.get('name')??''))
    : operation==='archive' ? await archiveAutomation(id,version) : await setAutomationEnabled(id,version,operation==='enable');
  if(!result.ok) return {error:result.error.message};
  revalidatePath(automationPath,'layout');
  return {success:operation==='archive'?'Automation archived. History is retained.':operation==='duplicate'?'Disabled copy created.':'Rule status updated. Global processing was not changed.',redirectTo:operation==='duplicate'?`${automationPath}/${result.value.rule.id}`:automationPath};
}
export async function runAutomationTest(input: unknown) { const result=await testAutomation(input); return {result,labels:result.ok?await automationResultLabels(result.value):{}}; }
export async function findAutomationChoices(resource: string, query: string, page: number, selected: string[] = []) {
  try { return {ok:true as const,value:await automationChoices(resource,query,page,selected)}; } catch { return {ok:false as const,error:'Choices could not load. Try again.'}; }
}
export async function findAutomationEvents(ticketId: string, page: number) {
  try { return {ok:true as const,value:await automationEvents(ticketId,page)}; } catch { return {ok:false as const,error:'Ticket events could not load. Try again.'}; }
}
