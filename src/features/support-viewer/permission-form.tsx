import { ActionForm } from '@/components/ui/action-form';
import { Checkbox } from '@/components/ui/checkbox';
import { SubmitButton } from '@/components/ui/submit-button';

import { saveInsightAccess } from './actions';
import type { MemberInsightAccess } from './model';

export function InsightPermissionForm({
  member,
  name,
}: {
  member: MemberInsightAccess;
  name: string;
}) {
  return (
    <section className="stack" aria-labelledby={`insight-access-${member.userId}`}>
      <h4 id={`insight-access-${member.userId}`}>Support insights</h4>
      <p className="muted">
        Optional read-only access. Their employee requests and chats work as usual.
      </p>
      <details>
        <summary>
          Edit support insight access<span className="sr-only"> for {name}</span>
        </summary>
        <ActionForm action={saveInsightAccess} className="stack" key={member.revision}>
          <input type="hidden" name="userId" value={member.userId} />
          <input type="hidden" name="revision" value={member.revision} />
          <label className="check-field">
            <Checkbox name="dashboard" defaultChecked={member.dashboard} />
            View support dashboard<span className="sr-only"> for {name}</span>
          </label>
          <p className="muted">Workspace statistics, technician workload and response trends.</p>
          <label className="check-field">
            <Checkbox name="sharedIncidents" defaultChecked={member.sharedIncidents} />
            View shared incidents<span className="sr-only"> for {name}</span>
          </label>
          <p className="muted">
            IT-approved incident and High/Urgent summaries. Internal notes, conversations and
            attachments stay private.
          </p>
          <SubmitButton variant="secondary">
            Save insight access<span className="sr-only"> for {name}</span>
          </SubmitButton>
        </ActionForm>
      </details>
    </section>
  );
}
