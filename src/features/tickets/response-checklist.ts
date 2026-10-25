import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';

import { parseDeadline } from './deadlines';

export type IncidentStep = {
  id: string;
  organization_id: string;
  ticket_id: string;
  title: string;
  instructions: string;
  assignee_id: string;
  due_at: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  application_id: string | null;
  procedure_position: number | null;
  work_version: number;
  assignment_token: string;
  assignment_started_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};
export type StepHistory = {
  id: number;
  organization_id: string;
  ticket_id: string;
  step_id: string;
  actor_id: string;
  action: string;
  snapshot: IncidentStep;
  created_at: string;
};
export function stepState(
  step: Pick<IncidentStep, 'completed_at' | 'acknowledged_at' | 'due_at'>,
  now = Date.now(),
) {
  if (step.completed_at) return 'Completed';
  if (step.due_at && new Date(step.due_at).getTime() < now)
    return step.acknowledged_at ? 'Overdue · acknowledged' : 'Overdue · awaiting acknowledgement';
  return step.acknowledged_at ? 'Acknowledged' : 'Awaiting acknowledgement';
}
export function parseStep(form: FormData) {
  const title = formString(form, 'title', '').trim(),
    instructions = formString(form, 'instructions', '').trim();
  const assignee_id = formString(form, 'assigneeId', ''),
    deadline = formString(form, 'dueAt', '');
  if (title.length < 3 || title.length > 180 || instructions.length > 4000 || !isUuid(assignee_id))
    return {
      error:
        'Enter a step title (3–180 characters), an active assignee, and instructions up to 4,000 characters.',
    };
  const due_at = parseDeadline(
    deadline,
    formString(form, 'dueTimezone', ''),
    formString(form, 'dueOccurrence', ''),
  );
  if (due_at === undefined)
    return {
      error:
        'Enter a valid deadline in the displayed timezone. For a repeated time, choose its occurrence.',
    };
  return { data: { title, instructions, assignee_id, due_at } };
}
