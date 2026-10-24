// Email-safe equivalents of DESIGN_SYSTEM.md tokens; inline styles survive mail clients.
export const invitationConfirmationHref = '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite';

export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export type EmailPurpose = 'workspace' | 'account-access' | 'security-alert' | 'notification';

const purposeLabels: Record<EmailPurpose, string> = {
  workspace: 'Your workspace',
  'account-access': 'Account access',
  'security-alert': 'Account security',
  notification: 'Workspace update',
};

// These Go template branches are evaluated by Supabase, using presentation-only metadata.
function renderInvitationOverview(): string {
  const list = (items: [string, string][]) => `<ul role="list" style="list-style:none;margin:0;padding:0;text-align:center">${items.map(([title, description], index) => `<li style="margin:${index ? '20px' : '0'} 0 0"><strong style="display:block;margin:0 0 4px;font-size:16px;line-height:24px;font-weight:600;color:#282d33">${escapeEmailHtml(title)}</strong><span style="display:block;font-size:14px;line-height:22px;color:#6e676f">${escapeEmailHtml(description)}</span></li>`).join('')}</ul>`;
  return `<p style="max-width:420px;margin:0 auto 32px;overflow-wrap:anywhere">{{ if .Data.invited_by }}<strong>{{ .Data.invited_by }}</strong> has invited you{{ else }}Your team has invited you{{ end }} to join {{ if .Data.workspace_name }}<strong>{{ .Data.workspace_name }}</strong> on FixxFlow{{ else }}its FixxFlow workspace{{ end }}.</p>
<div style="margin:0 0 32px;padding:24px 16px;background:#f1f2f3;border-radius:12px;text-align:center">
<h2 style="margin:0 0 24px;font-size:18px;line-height:24px;font-weight:600">What you can do in FixxFlow</h2>
{{ if eq .Data.invitation_role "administrator" }}
${list([['Keep support moving', 'Manage tickets, priorities, and team assignments.'], ['Bring your team together', 'Invite teammates and manage workspace access.'], ['Shape your workspace', 'Configure your workspace and review support reports.']])}
{{ else if eq .Data.invitation_role "technician" }}
${list([['See what needs attention', 'Manage your ticket queue and track priorities.'], ['Work together', 'Collaborate with teammates using internal notes.'], ['Keep people informed', 'Reply to requests and keep employees updated.']])}
{{ else }}
${list([['Get help when you need it', 'Submit IT requests in one place.'], ['Follow every update', 'Track progress and see updates on your requests.'], ['Stay connected', 'Reply to your support team and keep the conversation together.']])}
{{ end }}</div>`;
}

export function renderEmail({ title, message, action, href, code, note, invitation = false, purpose = 'notification', siteUrl = 'https://www.fixxflow.app', preserveLines = false, notificationLabel, details = [], replyPreview }: {
  title: string; message: string; action?: string; href?: string; code?: string; note?: string; invitation?: boolean; purpose?: EmailPurpose; siteUrl?: string; preserveLines?: boolean; notificationLabel?: string; details?: { label: string; value: string }[]; replyPreview?: string;
}): string {
  const e = escapeEmailHtml;
  const origin = new URL(siteUrl).origin;
  if (!origin.startsWith('https://')) throw new Error('Email assets require HTTPS');
  if (href && href !== '{{ .ConfirmationURL }}' && href !== invitationConfirmationHref && !/^https:\/\//.test(href)) throw new Error('Invalid email action URL');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${e(title)} | FixxFlow</title></head>
<body style="margin:0;padding:0;background:#f1f2f3;color:#282d33;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:24px">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${e(message)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f2f3"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fbfffe;border:0;border-radius:16px"><tr aria-hidden="true"><td height="4" bgcolor="#bd212c" style="height:4px;font-size:0;line-height:0;background:#bd212c;background-image:linear-gradient(90deg,#bd212c,#a71d27);border-radius:16px 16px 0 0">&nbsp;</td></tr><tr><td align="center" style="padding:24px 24px 8px;background:#fbfffe">
<a href="${e(origin)}" style="text-decoration:none"><img src="${e(origin)}/brand/fixxflow/logo/fixxflow-logo-primary.png?v=red-gunmetal-20261023" width="120" height="118" alt="FixxFlow — IT Support in Motion" style="display:block;width:120px;height:auto;border:0;color:#282d33;font-size:16px"></a>
</td></tr><tr><td align="center" style="padding:24px;text-align:center;overflow-wrap:anywhere">
<p style="margin:0 0 8px;color:#6e676f;font-size:14px;line-height:22px;font-weight:500">${e(notificationLabel ?? purposeLabels[purpose])}</p>
<h1 style="margin:0 0 16px;font-size:28px;line-height:36px;font-weight:600;letter-spacing:-0.5px;color:#282d33">${e(title)}</h1>
<p style="max-width:420px;margin:0 auto 20px;color:#6e676f;${preserveLines ? 'white-space:pre-line;' : ''}">${e(message)}</p>
${details.length ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;text-align:left;font-size:14px;line-height:22px"><caption style="text-align:left;font-weight:600;color:#282d33;padding:0 0 8px">Ticket details</caption><tbody>${details.map(detail => `<tr><th scope="row" style="width:35%;padding:6px 12px 6px 0;color:#6e676f;font-weight:500;vertical-align:top">${e(detail.label)}</th><td style="padding:6px 0;color:#282d33;overflow-wrap:anywhere">${e(detail.value)}</td></tr>`).join('')}</tbody></table>` : ''}
${replyPreview ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;text-align:left"><tr><td style="padding:16px;background:#f1f2f3;border-radius:8px"><h2 style="margin:0 0 8px;color:#282d33;font-size:16px;line-height:24px;font-weight:600">Reply preview</h2><p style="margin:0;color:#282d33;white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:24px">${e(replyPreview)}</p></td></tr></table>` : ''}
${invitation ? `${renderInvitationOverview()}\n` : ''}${code ? `<p style="margin:0 0 24px;padding:16px;background:#f1f2f3;border:0;border-radius:8px;font-size:28px;line-height:36px;font-weight:700;letter-spacing:6px;text-align:center">${e(code)}</p>` : ''}
${action && href ? `<table role="presentation" align="center" style="margin:0 auto" cellpadding="0" cellspacing="0"><tr><td bgcolor="#bd212c" style="border-radius:8px"><a href="${e(href)}" style="display:inline-block;padding:14px 24px;border:1px solid #bd212c;border-radius:8px;background:#bd212c;color:#fbfffe;text-decoration:none;font-size:16px;font-weight:600;line-height:24px">${e(action)}</a></td></tr></table><p style="text-align:center;margin:16px 0 0;font-size:13px;line-height:20px;color:#6e676f">Button not working? Copy this link:<br><a href="${e(href)}" style="color:#6e676f;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">${e(href)}</a></p>` : ''}
${note ? purpose === 'security-alert'
  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td align="center" bgcolor="#fff7e6" style="text-align:center;padding:16px;background:#fff7e6;border-radius:8px"><h2 style="margin:0 0 8px;color:#a15c00;font-size:14px;line-height:22px;font-weight:700">Security notice</h2><p style="margin:0;color:#282d33;font-size:14px;line-height:22px">${e(note)}</p></td></tr></table>`
  : `<p style="text-align:center;margin:24px 0 0;color:#6e676f;font-size:14px;line-height:22px">${e(note)}</p>` : ''}
</td></tr><tr><td align="center" style="text-align:center;padding:16px 24px;border-top:1px solid #f1f2f3;color:#6e676f;font-size:13px;line-height:20px">Here to help. <a href="mailto:support@fixxflow.app" style="color:#6e676f;text-decoration:underline">Contact support</a><br>FixxFlow · IT support in motion</td></tr></table>
</td></tr></table></body></html>`;
}
