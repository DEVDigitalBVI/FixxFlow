/** Local, synthetic rendering only. Never sends mail or reads user data. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { load } from './load-module.mjs';

const { renderEmail } = load('src/features/notifications/template.ts');
const port = Number(process.argv[2] ?? 4398);
const pages = new Map();

function previewValues(html) {
  return html
    .replace(/{{ if \.Data\.invited_by }}([\s\S]*?){{ else }}[\s\S]*?{{ end }}/g, '$1')
    .replace(/{{ if \.Data\.workspace_name }}([\s\S]*?){{ else }}[\s\S]*?{{ end }}/g, '$1')
    .replace(
      /{{ if eq \.Data\.invitation_role "administrator" }}[\s\S]*?{{ else if eq \.Data\.invitation_role "technician" }}[\s\S]*?{{ else }}([\s\S]*?){{ end }}/g,
      '$1',
    )
    .replaceAll('{{ .Data.invited_by }}', 'Jordan Morgan')
    .replaceAll('{{ .Data.workspace_name }}', 'Example workspace')
    .replaceAll('{{ .Token }}', '123456')
    .replaceAll('{{ .NewEmail }}', 'new-address@example.invalid')
    .replaceAll('{{ .OldEmail }}', 'old-address@example.invalid')
    .replaceAll('{{ .Email }}', 'person@example.invalid')
    .replaceAll('{{ .OldPhone }}', '+1 284 555 0100')
    .replaceAll('{{ .Phone }}', '+1 284 555 0101')
    .replaceAll('{{ .Provider }}', 'Microsoft')
    .replaceAll('{{ .FactorType }}', 'Authenticator')
    .replaceAll('https://fixxflow.com/brand/', '/brand/');
}

for (const file of fs.readdirSync('supabase/templates').filter((name) => name.endsWith('.html')))
  pages.set(
    file.replace('.html', ''),
    previewValues(fs.readFileSync(`supabase/templates/${file}`, 'utf8')),
  );

const base = {
  workspaceName: 'Example workspace',
  title: 'Your IT support update',
  message: 'Your support team has an update on your request.',
  href: 'https://fixxflow.com/app/tickets/fixture',
  action: 'Open ticket',
};
const variants = {
  'ticket-created': {
    ...base,
    title: 'Ticket #1842: VPN disconnects during video calls',
    notificationLabel: 'New ticket',
    details: [
      { label: 'Requester', value: 'Taylor Example-With-A-Long-Name' },
      { label: 'Email', value: 'taylor.long.email.address@example.invalid' },
      { label: 'Location', value: 'Head office / First floor / East wing / Meeting room 101' },
      { label: 'Priority', value: 'High' },
    ],
  },
  'ticket-reply': {
    ...base,
    title: 'IT replied to your request',
    replyPreview:
      'Hi Taylor,\n\nPlease try reconnecting to the VPN. If it still disconnects, reply with the time it happened so we can check the connection logs.',
    note: 'Reply in FixxFlow to keep the conversation with your request.',
  },
  'ticket-reopened': {
    ...base,
    title: 'Your request was reopened',
    reopenReason:
      'The connection worked briefly, then disconnected again during our next meeting.\n\nSeveral colleagues are experiencing the same issue.',
    note: 'Your existing conversation and reference number are retained.',
  },
  'ticket-status': {
    ...base,
    title: 'Your request is resolved',
    status: 'Resolved',
    note: 'If the issue returns, reopen the request in FixxFlow.',
  },
  'daily-digest': {
    ...base,
    title: 'Your daily summary',
    action: 'View updates',
    preserveLines: true,
    message:
      '10 updates are waiting for you.\n\n' +
      Array.from(
        { length: 10 },
        (_, i) => `• Update ${i + 1}: A request, chat or equipment item needs your attention.`,
      ).join('\n'),
    note: 'Open FixxFlow to reply or change your email preferences.',
  },
  'scheduled-report': {
    ...base,
    title: 'Weekly service performance and support workload report',
    notificationLabel: 'Scheduled report',
    message: 'Your scheduled report is ready. The requested file is attached to this email.',
    action: 'Open live report',
  },
  'incident-update': {
    ...base,
    title: 'Network connectivity update for the main office',
    notificationLabel: 'Incident update',
    status: 'Monitoring',
    preserveLines: true,
    message:
      'Network connectivity has been restored.\n\nWe are monitoring the service. If you are still affected, reconnect and contact IT with your location.',
    note: 'This is an approved update from your IT support team.',
  },
  'plain-notification': {
    ...base,
    title: 'Your equipment request is ready',
    action: undefined,
    href: undefined,
    note: 'Contact IT to arrange collection of your equipment.',
  },
};
for (const [name, props] of Object.entries(variants))
  pages.set(name, previewValues(await renderEmail(props)));

http
  .createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/manifest.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify([...pages.keys()]));
    } else if (url.pathname.startsWith('/brand/')) {
      const filename = path.resolve('public', `.${url.pathname}`);
      if (
        !filename.startsWith(path.resolve('public/brand') + path.sep) ||
        !fs.existsSync(filename)
      ) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader('Content-Type', filename.endsWith('.woff2') ? 'font/woff2' : 'image/png');
      response.end(fs.readFileSync(filename));
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        pages.get(url.pathname.slice(1)) ??
          `<html><body><h1>Email previews</h1><ul>${[...pages.keys()].map((name) => `<li><a href="/${name}">${name}</a></li>`).join('')}</ul></body></html>`,
      );
    }
  })
  .listen(port, '127.0.0.1', () =>
    console.log(`Email previews: http://127.0.0.1:${port} (${pages.size} templates)`),
  );
