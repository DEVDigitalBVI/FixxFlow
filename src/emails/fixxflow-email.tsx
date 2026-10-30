import {
  EmailAction,
  EmailCallout,
  EmailCode,
  EmailDetails,
  EmailEyebrow,
  EmailLayout,
  EmailNote,
  EmailQuote,
  EmailStatus,
  EmailTemplateText,
  EmailText,
  EmailTitle,
  emailTokens,
} from './components';

export type EmailPurpose = 'workspace' | 'account-access' | 'security-alert' | 'notification';

const purposeLabels: Record<EmailPurpose, string> = {
  workspace: 'Your workspace',
  'account-access': 'Account access',
  'security-alert': 'Account security',
  notification: 'IT update',
};

// Go template branches evaluated by Supabase from presentation-only metadata. The invitation
// leads with who invited the person and where, then the action, then one role sentence.
const invitationLead = `{{ if .Data.invited_by }}<strong>{{ .Data.invited_by }}</strong> invited you{{ else }}Your team invited you{{ end }} to join {{ if .Data.workspace_name }}<strong>{{ .Data.workspace_name }}</strong> on FixxFlow{{ else }}its FixxFlow workspace{{ end }}, where your team handles IT support.`;
const invitationRole = `{{ if eq .Data.invitation_role "administrator" }}As an administrator, you can manage tickets, invite teammates and manage workspace access.{{ else if eq .Data.invitation_role "technician" }}As a technician, you can work the ticket queue, collaborate using internal notes and keep employees updated.{{ else }}You can submit IT requests, follow their progress and reply to your support team.{{ end }}`;

type FixxFlowEmailProps = {
  title: string;
  message: string;
  origin: string;
  action?: string;
  href?: string;
  code?: string;
  note?: string;
  invitation?: boolean;
  purpose?: EmailPurpose;
  preserveLines?: boolean;
  notificationLabel?: string;
  details?: { label: string; value: string }[];
  replyPreview?: string;
  reopenReason?: string;
  workspaceName?: string;
  status?: string;
};

/** The one FixxFlow email: every notification, digest, report and Supabase auth message. */
export function FixxFlowEmail({
  title,
  message,
  origin,
  action,
  href,
  code,
  note,
  invitation = false,
  purpose = 'notification',
  preserveLines = false,
  notificationLabel,
  details = [],
  replyPreview,
  reopenReason,
  workspaceName,
  status,
}: FixxFlowEmailProps) {
  return (
    <EmailLayout title={title} preview={message} origin={origin} workspaceName={workspaceName}>
      <EmailEyebrow>{notificationLabel ?? purposeLabels[purpose]}</EmailEyebrow>
      <EmailTitle>{title}</EmailTitle>
      {status && <EmailStatus>{status}</EmailStatus>}
      {invitation ? (
        <EmailTemplateText
          html={invitationLead}
          style={{ margin: '0 0 20px', color: emailTokens.text }}
        />
      ) : preserveLines ? (
        <EmailText lines={message} />
      ) : (
        <EmailText>{message}</EmailText>
      )}
      {details.length > 0 && <EmailDetails caption="Ticket details" rows={details} />}
      {reopenReason && (
        <EmailCallout heading="Reason for reopening">
          <EmailQuote>{reopenReason}</EmailQuote>
        </EmailCallout>
      )}
      {replyPreview && (
        <EmailCallout heading="Reply preview">
          <EmailQuote>{replyPreview}</EmailQuote>
        </EmailCallout>
      )}
      {code && <EmailCode>{code}</EmailCode>}
      {action && href && <EmailAction href={href}>{action}</EmailAction>}
      {invitation && (
        <EmailTemplateText
          html={invitationRole}
          style={{
            margin: '24px 0 0',
            color: emailTokens.text,
            fontSize: '14px',
            lineHeight: '22px',
          }}
        />
      )}
      {note &&
        (purpose === 'security-alert' ? (
          <EmailCallout heading="Security notice" tone="warning" style={{ marginTop: '24px' }}>
            <p style={{ margin: 0, color: emailTokens.text, fontSize: '14px', lineHeight: '22px' }}>
              {note}
            </p>
          </EmailCallout>
        ) : (
          <EmailNote>{note}</EmailNote>
        ))}
    </EmailLayout>
  );
}
