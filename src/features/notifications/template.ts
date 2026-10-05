// Email-safe equivalents of DESIGN_SYSTEM.md tokens; inline styles survive mail clients.
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

export function renderEmail({ title, message, action, href, code, note, purpose = 'notification', siteUrl = 'https://www.fixxflow.app' }: {
  title: string; message: string; action?: string; href?: string; code?: string; note?: string; purpose?: EmailPurpose; siteUrl?: string;
}): string {
  const e = escapeEmailHtml;
  const origin = new URL(siteUrl).origin;
  if (!origin.startsWith('https://')) throw new Error('Email assets require HTTPS');
  if (href && href !== '{{ .ConfirmationURL }}' && !/^https:\/\//.test(href)) throw new Error('Invalid email action URL');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${e(title)} | FixxFlow</title></head>
<body style="margin:0;padding:0;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:24px">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${e(message)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px"><tr aria-hidden="true"><td height="4" bgcolor="#007aff" style="height:4px;font-size:0;line-height:0;background:#007aff;background-image:linear-gradient(90deg,#007aff,#00c6ff);border-radius:16px 16px 0 0">&nbsp;</td></tr><tr><td align="center" style="padding:24px 24px 8px;background:#ffffff">
<a href="${e(origin)}" style="text-decoration:none"><img src="${e(origin)}/brand/fixxflow/logo/fixxflow-logo-primary.png" width="120" height="118" alt="FixxFlow — IT Support in Motion" style="display:block;width:120px;height:auto;border:0;color:#0f172a;font-size:16px"></a>
</td></tr><tr><td style="padding:24px">
<p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:20px;font-weight:600;letter-spacing:1px;text-transform:uppercase">${e(purposeLabels[purpose])}</p>
<h1 style="margin:0 0 16px;font-size:28px;line-height:36px;font-weight:700;letter-spacing:-0.5px;color:#0f172a">${e(title)}</h1>
<p style="margin:0 0 24px">${e(message)}</p>
${code ? `<p style="margin:0 0 24px;padding:16px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;font-size:28px;line-height:36px;font-weight:700;letter-spacing:6px;text-align:center">${e(code)}</p>` : ''}
${action && href ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#0066d6" style="border-radius:8px"><a href="${e(href)}" style="display:inline-block;padding:14px 24px;border:1px solid #0066d6;border-radius:8px;background:#0066d6;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;line-height:24px">${e(action)}</a></td></tr></table><p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#64748b">Button not working? Copy this link:<br><a href="${e(href)}" style="color:#64748b;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">${e(href)}</a></p>` : ''}
${note ? purpose === 'security-alert'
  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td bgcolor="#fff7e6" style="padding:16px;background:#fff7e6;border-radius:8px"><h2 style="margin:0 0 8px;color:#a15c00;font-size:14px;line-height:22px;font-weight:700">Security notice</h2><p style="margin:0;color:#0f172a;font-size:14px;line-height:22px">${e(note)}</p></td></tr></table>`
  : `<p style="margin:24px 0 0;color:#64748b;font-size:14px;line-height:22px">${e(note)}</p>` : ''}
</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;color:#64748b;font-size:13px;line-height:20px">Here to help. <a href="mailto:support@fixxflow.app" style="color:#64748b;text-decoration:underline">Contact support</a><br>FixxFlow · IT support in motion</td></tr></table>
</td></tr></table></body></html>`;
}
