// Email-safe equivalents of DESIGN_SYSTEM.md tokens; inline styles survive mail clients.
export const invitationConfirmationHref =
  '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite';

export function escapeEmailHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

export type EmailPurpose = 'workspace' | 'account-access' | 'security-alert' | 'notification';

const purposeLabels: Record<EmailPurpose, string> = {
  workspace: 'Your workspace',
  'account-access': 'Account access',
  'security-alert': 'Account security',
  notification: 'IT update',
};

// These Go template branches are evaluated by Supabase, using presentation-only metadata.
// The invitation leads with who invited the person and where, then the action.
function renderInvitationLead(): string {
  return `<p style="margin:0 0 20px;color:#212529;">{{ if .Data.invited_by }}<strong>{{ .Data.invited_by }}</strong> invited you{{ else }}Your team invited you{{ end }} to join {{ if .Data.workspace_name }}<strong>{{ .Data.workspace_name }}</strong> on FixxFlow{{ else }}its FixxFlow workspace{{ end }}, where your team handles IT support.</p>`;
}

function renderInvitationRole(): string {
  return `<p style="margin:24px 0 0;color:#212529;font-size:14px;line-height:22px">{{ if eq .Data.invitation_role "administrator" }}As an administrator, you can manage tickets, invite teammates and manage workspace access.{{ else if eq .Data.invitation_role "technician" }}As a technician, you can work the ticket queue, collaborate using internal notes and keep employees updated.{{ else }}You can submit IT requests, follow their progress and reply to your support team.{{ end }}</p>`;
}

export function renderEmail({
  title,
  message,
  action,
  href,
  code,
  note,
  invitation = false,
  purpose = 'notification',
  siteUrl = 'https://fixxflow.com',
  preserveLines = false,
  notificationLabel,
  details = [],
  replyPreview,
  reopenReason,
  workspaceName,
  status,
}: {
  title: string;
  message: string;
  action?: string;
  href?: string;
  code?: string;
  note?: string;
  invitation?: boolean;
  purpose?: EmailPurpose;
  siteUrl?: string;
  preserveLines?: boolean;
  notificationLabel?: string;
  details?: { label: string; value: string }[];
  replyPreview?: string;
  reopenReason?: string;
  workspaceName?: string;
  status?: string;
}): string {
  const e = escapeEmailHtml;
  const origin = new URL(siteUrl).origin;
  if (!origin.startsWith('https://')) throw new Error('Email assets require HTTPS');
  if (
    href &&
    href !== '{{ .ConfirmationURL }}' &&
    href !== invitationConfirmationHref &&
    !/^https:\/\//.test(href)
  )
    throw new Error('Invalid email action URL');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${e(title)} | FixxFlow</title></head>
<body style="margin:0;padding:0;background:#f1f3f5;color:#212529;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:24px">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${e(message)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:0;border-radius:16px"><tr aria-hidden="true"><td height="4" bgcolor="#ffd700" style="height:4px;font-size:0;line-height:0;background:#ffd700;background-image:linear-gradient(90deg,#ffd700,#e6c200);border-radius:16px 16px 0 0">&nbsp;</td></tr><tr><td align="left" style="padding:24px 24px 0;background:#ffffff">
<a href="${e(origin)}" style="text-decoration:none"><img src="${e(origin)}/brand/fixxflow/logo/fixxflow-logo-horizontal.png?v=yellow-charcoal-20261028" width="136" alt="FixxFlow" style="display:block;width:136px;max-width:100%;height:auto;border:0;color:#212529;font-size:16px"></a>
${workspaceName ? `<p style="margin:12px 0 0;font-size:14px;line-height:22px;font-weight:600;color:#212529;overflow-wrap:anywhere">${e(workspaceName)}</p>` : ''}
</td></tr><tr><td align="left" style="padding:20px 24px 24px;text-align:left;overflow-wrap:anywhere">
<p style="margin:0 0 8px;color:#545b62;font-size:14px;line-height:22px;font-weight:500">${e(notificationLabel ?? purposeLabels[purpose])}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.3px;color:#212529">${e(title)}</h1>
${status ? `<p style="margin:0 0 16px;font-size:14px;line-height:22px;color:#212529"><strong>Status:</strong> ${e(status)}</p>` : ''}
${invitation ? renderInvitationLead() : `<p style="margin:0 0 20px;color:#212529;">${preserveLines ? e(message).replace(/\r?\n/g, '<br>') : e(message)}</p>`}
${details.length ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;text-align:left;font-size:14px;line-height:22px"><caption style="text-align:left;font-weight:600;color:#212529;padding:0 0 8px">Ticket details</caption><tbody>${details.map((detail) => `<tr><th scope="row" style="width:35%;padding:6px 12px 6px 0;color:#545b62;font-weight:500;vertical-align:top">${e(detail.label)}</th><td style="padding:6px 0;color:#212529;overflow-wrap:anywhere">${e(detail.value)}</td></tr>`).join('')}</tbody></table>` : ''}
${reopenReason ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;text-align:left"><tr><td style="padding:16px;background:#f1f3f5;border-radius:8px"><h2 style="margin:0 0 8px;color:#212529;font-size:16px;line-height:24px;font-weight:600">Reason for reopening</h2><p style="margin:0;color:#212529;white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:24px">${e(reopenReason)}</p></td></tr></table>` : ''}
${replyPreview ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;text-align:left"><tr><td style="padding:16px;background:#f1f3f5;border-radius:8px"><h2 style="margin:0 0 8px;color:#212529;font-size:16px;line-height:24px;font-weight:600">Reply preview</h2><p style="margin:0;color:#212529;white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:24px">${e(replyPreview)}</p></td></tr></table>` : ''}
${code ? `<p style="margin:0 0 24px;padding:16px;background:#f1f3f5;border:0;border-radius:8px;font-size:28px;line-height:36px;font-weight:700;letter-spacing:6px;text-align:left">${e(code)}</p>` : ''}
${action && href ? `<table role="presentation" style="margin:0" cellpadding="0" cellspacing="0"><tr><td bgcolor="#ffd700" style="border-radius:8px"><a href="${e(href)}" style="display:inline-block;padding:10px 18px;border:1px solid #212529;border-radius:8px;background:#ffd700;color:#212529;text-decoration:none;font-size:16px;font-weight:600;line-height:24px">${e(action)}</a></td></tr></table><p style="margin:12px 0 0;font-size:13px;line-height:20px;color:#545b62">Or <a href="${e(href)}" style="color:#212529;text-decoration:underline">open this link</a>.</p>` : ''}${invitation ? `\n${renderInvitationRole()}` : ''}
${
  note
    ? purpose === 'security-alert'
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td align="left" bgcolor="#fff8cc" style="text-align:left;padding:16px;background:#fff8cc;border-radius:8px"><h2 style="margin:0 0 8px;color:#655600;font-size:14px;line-height:22px;font-weight:700">Security notice</h2><p style="margin:0;color:#212529;font-size:14px;line-height:22px">${e(note)}</p></td></tr></table>`
      : `<p style="text-align:left;margin:24px 0 0;color:#545b62;font-size:14px;line-height:22px">${e(note)}</p>`
    : ''
}
</td></tr><tr><td align="left" style="text-align:left;padding:16px 24px;border-top:1px solid #f1f3f5;color:#545b62;font-size:13px;line-height:20px">Need help? <a href="mailto:support@fixxflow.app" style="color:#545b62;text-decoration:underline">Contact FixxFlow support</a></td></tr></table>
</td></tr></table></body></html>`;
}
