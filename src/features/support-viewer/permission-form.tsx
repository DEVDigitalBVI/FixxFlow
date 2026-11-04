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
    <section className="stack insight-access" aria-labelledby={`insight-access-${member.userId}`}>
      <h4 id={`insight-access-${member.userId}`}>Support insights</h4>
      <p className="muted">Add read-only visibility. Personal requests and chats work as usual.</p>
      <details>
        <summary>
          Edit permissions<span className="sr-only"> for {name}</span>
        </summary>
        <ActionForm
          action={saveInsightAccess}
          className="insight-access-form"
          key={member.revision}
        >
          <input type="hidden" name="userId" value={member.userId} />
          <input type="hidden" name="revision" value={member.revision} />
          <div className="insight-access-options">
            <label className="insight-access-option">
              <Checkbox
                name="dashboard"
                defaultChecked={member.dashboard}
                aria-labelledby={`dashboard-label-${member.userId}`}
                aria-describedby={`dashboard-help-${member.userId}`}
              />
              <span className="insight-access-copy">
                <strong id={`dashboard-label-${member.userId}`}>
                  View support dashboard<span className="sr-only"> for {name}</span>
                </strong>
                <span id={`dashboard-help-${member.userId}`}>
                  See workspace ticket totals, technician workload and response times.
                </span>
              </span>
            </label>
            <label className="insight-access-option">
              <Checkbox
                name="sharedIncidents"
                defaultChecked={member.sharedIncidents}
                aria-labelledby={`incidents-label-${member.userId}`}
                aria-describedby={`incidents-help-${member.userId}`}
              />
              <span className="insight-access-copy">
                <strong id={`incidents-label-${member.userId}`}>
                  View shared incidents<span className="sr-only"> for {name}</span>
                </strong>
                <span id={`incidents-help-${member.userId}`}>
                  Read summaries IT publishes for incidents and High/Urgent tickets, including the
                  resolution.
                </span>
              </span>
            </label>
          </div>
          <p className="insight-access-limits">
            View only. Other employees’ conversations, internal notes and attachments stay private.
          </p>
          <SubmitButton variant="secondary">
            Save insight access<span className="sr-only"> for {name}</span>
          </SubmitButton>
        </ActionForm>
      </details>
    </section>
  );
}
