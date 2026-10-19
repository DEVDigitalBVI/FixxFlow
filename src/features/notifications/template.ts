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
  const list = (items: [string, string][]) => `<ul role="list" style="list-style:none;margin:0;padding:0;text-align:center">${items.map(([title, description], index) => `<li style="margin:${index ? '20px' : '0'} 0 0"><strong style="display:block;margin:0 0 4px;font-size:16px;line-height:24px;font-weight:600;color:#14213d">${escapeEmailHtml(title)}</strong><span style="display:block;font-size:14px;line-height:22px;color:#595959">${escapeEmailHtml(description)}</span></li>`).join('')}</ul>`;
  return `<p style="max-width:420px;margin:0 auto 32px;overflow-wrap:anywhere">{{ if .Data.invited_by }}<strong>{{ .Data.invited_by }}</strong> has invited you{{ else }}Your team has invited you{{ end }} to join {{ if .Data.workspace_name }}<strong>{{ .Data.workspace_name }}</strong> on FixxFlow{{ else }}its FixxFlow workspace{{ end }}.</p>
<div style="margin:0 0 32px;padding:24px 16px;background:#f5f5f5;border-radius:12px;text-align:center">
<h2 style="margin:0 0 24px;font-size:18px;line-height:24px;font-weight:600">What you can do in FixxFlow</h2>
{{ if eq .Data.invitation_role "administrator" }}
${list([['Keep support moving', 'Manage tickets, priorities, and team assignments.'], ['Bring your team together', 'Invite teammates and manage workspace access.'], ['Shape your workspace', 'Configure your workspace and review support reports.']])}
{{ else if eq .Data.invitation_role "technician" }}
${list([['See what needs attention', 'Manage your ticket queue and track priorities.'], ['Work together', 'Collaborate with teammates using internal notes.'], ['Keep people informed', 'Reply to requests and keep employees updated.']])}
{{ else }}
${list([['Get help when you need it', 'Submit IT requests in one place.'], ['Follow every update', 'Track progress and see updates on your requests.'], ['Stay connected', 'Reply to your support team and keep the conversation together.']])}
{{ end }}</div>`;
}

export function renderEmail({ title, message, action, href, code, note, invitation = false, purpose = 'notification', siteUrl = 'https://www.fixxflow.app' }: {
  title: string; message: string; action?: string; href?: string; code?: string; note?: string; invitation?: boolean; purpose?: EmailPurpose; siteUrl?: string;
}): string {
  const e = escapeEmailHtml;
  const origin = new URL(siteUrl).origin;
  if (!origin.startsWith('https://')) throw new Error('Email assets require HTTPS');
  if (href && href !== '{{ .ConfirmationURL }}' && href !== invitationConfirmationHref && !/^https:\/\//.test(href)) throw new Error('Invalid email action URL');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${e(title)} | FixxFlow</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;color:#14213d;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:24px">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${e(message)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e5e5;border-radius:16px"><tr aria-hidden="true"><td height="4" bgcolor="#fca311" style="height:4px;font-size:0;line-height:0;background:#fca311;background-image:linear-gradient(90deg,#fca311,#ffbb4d);border-radius:16px 16px 0 0">&nbsp;</td></tr><tr><td align="center" style="padding:24px 24px 8px;background:#ffffff">
<a href="${e(origin)}" style="text-decoration:none"><img src="${e(origin)}/brand/fixxflow/logo/fixxflow-logo-primary.png" width="120" height="118" alt="FixxFlow — IT Support in Motion" style="display:block;width:120px;height:auto;border:0;color:#14213d;font-size:16px"></a>
</td></tr><tr><td align="center" style="padding:24px;text-align:center;overflow-wrap:anywhere">
<p style="margin:0 0 8px;color:#595959;font-size:14px;line-height:22px;font-weight:500">${e(purposeLabels[purpose])}</p>
<h1 style="margin:0 0 16px;font-size:28px;line-height:36px;font-weight:700;letter-spacing:-0.5px;color:#14213d">${e(title)}</h1>
<p style="max-width:420px;margin:0 auto 20px;color:#595959;">${e(message)}</p>
${invitation ? `${renderInvitationOverview()}\n` : ''}${code ? `<p style="margin:0 0 24px;padding:16px;background:#f5f5f5;border:1px solid #e5e5e5;border-radius:8px;font-size:28px;line-height:36px;font-weight:700;letter-spacing:6px;text-align:center">${e(code)}</p>` : ''}
${action && href ? `<table role="presentation" align="center" style="margin:0 auto" cellpadding="0" cellspacing="0"><tr><td bgcolor="#fca311" style="border-radius:8px"><a href="${e(href)}" style="display:inline-block;padding:14px 24px;border:1px solid #885000;border-radius:8px;background:#fca311;color:#14213d;text-decoration:none;font-size:16px;font-weight:600;line-height:24px">${e(action)}</a></td></tr></table><p style="text-align:center;margin:16px 0 0;font-size:13px;line-height:20px;color:#595959">Button not working? Copy this link:<br><a href="${e(href)}" style="color:#595959;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">${e(href)}</a></p>` : ''}
${note ? purpose === 'security-alert'
  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td align="center" bgcolor="#fff7e6" style="text-align:center;padding:16px;background:#fff7e6;border-radius:8px"><h2 style="margin:0 0 8px;color:#a15c00;font-size:14px;line-height:22px;font-weight:700">Security notice</h2><p style="margin:0;color:#14213d;font-size:14px;line-height:22px">${e(note)}</p></td></tr></table>`
  : `<p style="text-align:center;margin:24px 0 0;color:#595959;font-size:14px;line-height:22px">${e(note)}</p>` : ''}
</td></tr><tr><td align="center" style="text-align:center;padding:16px 24px;border-top:1px solid #e5e5e5;color:#595959;font-size:13px;line-height:20px">Here to help. <a href="mailto:support@fixxflow.app" style="color:#595959;text-decoration:underline">Contact support</a><br>FixxFlow · IT support in motion</td></tr></table>
</td></tr></table></body></html>`;
}
