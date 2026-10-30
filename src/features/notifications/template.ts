// Renders the React Email kit (src/emails) to static HTML with React Email's renderer, which
// runs inside Next.js server code. Inline styles survive mail clients;
// React escapes all text and attributes, so callers pass plain strings.
import { createElement } from 'react';
import { render } from 'react-email';

import { FixxFlowEmail, type EmailPurpose } from '@/emails/fixxflow-email';

export type { EmailPurpose };
export const invitationConfirmationHref =
  '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite';

export function escapeEmailHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

export async function renderEmail({
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
}): Promise<string> {
  const origin = new URL(siteUrl).origin;
  if (!origin.startsWith('https://')) throw new Error('Email assets require HTTPS');
  if (
    href &&
    href !== '{{ .ConfirmationURL }}' &&
    href !== invitationConfirmationHref &&
    !/^https:\/\//.test(href)
  )
    throw new Error('Invalid email action URL');
  const html = await render(
    createElement(FixxFlowEmail, {
      title,
      message,
      origin,
      action,
      href,
      code,
      note,
      invitation,
      purpose,
      preserveLines,
      notificationLabel,
      details,
      replyPreview,
      reopenReason,
      workspaceName,
      status,
    }),
    { pretty: false },
  );
  // Keep the HTML5 doctype and drop React's streaming and text-boundary markers; they carry no
  // meaning in email. Outlook conditional comments (`<!--[if mso]>`) are left untouched.
  return `<!doctype html>\n${html
    .replace(/^<!DOCTYPE[^>]*>/i, '')
    .replace(/<!--(?:\/?\$|html|head|body| )-->/g, '')}`;
}
