/** Local chat layout fixture. Uses the real routes with synthetic, permission-scoped data. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from './load-module.mjs';

const chat = {
  id: 'chat-1',
  topic: 'VPN disconnects during video calls',
  requester_id: 'employee',
  assigned_technician_id: 'viewer',
  status: 'open',
  ticket_id: null,
  organization_id: 'org',
  updated_at: '2026-10-17T14:32:00Z',
};
const names = [
  { user_id: 'employee', display_name: 'Jordan Morgan' },
  { user_id: 'viewer', display_name: 'Alex Rivera' },
];
const messages = [
  {
    id: 'm1',
    author_id: 'employee',
    kind: 'message',
    body: 'Hi! My VPN keeps dropping during video calls. It started this morning.',
    created_at: '2026-10-17T14:28:00Z',
  },
  {
    id: 'm2',
    author_id: 'viewer',
    kind: 'message',
    body: 'Hi Jordan, I can help. Does this happen on your home network or in the office?',
    created_at: '2026-10-17T14:29:00Z',
  },
  {
    id: 'm3',
    author_id: 'employee',
    kind: 'message',
    body: 'At home. Everything else stays connected, but the VPN disconnects after a few minutes.',
    created_at: '2026-10-17T14:31:00Z',
  },
  {
    id: 'm4',
    author_id: 'viewer',
    kind: 'internal_note',
    body: 'Checking the VPN client version before restarting the connection.',
    created_at: '2026-10-17T14:32:00Z',
  },
];
const rows = Array.from({ length: 8 }, (_, i) => ({
  ...chat,
  id: `chat-${i + 1}`,
  topic: [
    'VPN disconnects during video calls',
    'New laptop setup',
    'Access to the finance folder',
    'Printer is showing offline',
    'Email on my phone',
    'Help with a software update',
    'Conference room display',
    'Password reset',
  ][i],
  requester_id: i ? 'other' : 'employee',
  assigned_technician_id: i % 2 ? null : 'viewer',
  chat_messages: [
    {
      body: i ? 'Thanks for checking. I’m available now.' : messages[2].body,
      author_id: 'employee',
    },
  ],
  notifications: [{ count: i < 3 ? i + 1 : 0 }],
}));
const attachments = [
  {
    id: 'file-image',
    file_name: 'VPN screenshot.png',
    storage_path: 'preview-image',
    content_type: 'image/png',
    size_bytes: 32000,
    uploaded_by: 'employee',
    created_at: '2026-10-17T14:31:30Z',
  },
  {
    id: 'file-audio',
    file_name: 'Support recording.wav',
    storage_path: 'preview-audio',
    content_type: 'audio/wav',
    size_bytes: 16044,
    uploaded_by: 'viewer',
    created_at: '2026-10-17T14:33:00Z',
  },
];
function mocks(personal, media = false) {
  const query = (table) =>
    new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'then'
            ? (resolve) =>
                Promise.resolve({
                  data:
                    table === 'chat_conversations'
                      ? rows
                      : table === 'chat_messages'
                        ? messages.filter((m) => !personal || m.kind === 'message').toReversed()
                        : table === 'chat_attachments' && media
                          ? attachments
                          : [],
                  error: null,
                }).then(resolve)
            : key === 'maybeSingle'
              ? async () => ({ data: chat, error: null })
              : () => query(table),
      },
    );
  return {
    'next/image': {
      default: (props) => {
        const attributes = { ...props };
        delete attributes.fill;
        delete attributes.priority;
        delete attributes.unoptimized;
        delete attributes.preload;
        return React.createElement('img', attributes);
      },
    },
    'next/link': {
      default: (props) => {
        const attributes = { ...props };
        delete attributes.scroll;
        delete attributes.prefetch;
        return React.createElement('a', attributes);
      },
    },
    'next/navigation': {
      useRouter: () => ({ refresh() {} }),
      usePathname: () => '/app/chat',
      notFound() {
        throw Error('not found');
      },
    },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({
        id: personal ? 'employee' : 'viewer',
        role: personal ? 'end_user' : 'technician',
        organizationId: 'org',
        organizationName: 'Northstar workspace',
        displayName: 'Alex Rivera',
        timeZone: 'UTC',
        timezonePreference: 'UTC',
      }),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        from: query,
        storage: {
          from: () => ({
            createSignedUrls: async (paths) => ({
              data: paths.map((storage_path) => ({
                path: storage_path,
                signedUrl:
                  storage_path === 'preview-audio'
                    ? '/sample.wav'
                    : '/brand/fixxflow/icon/fixxflow-icon-primary.png',
              })),
            }),
          }),
        },
      }),
    },
    '@/features/inventory/access': {
      inventoryAccess: async () => ({ manager: false, departments: [] }),
    },
    '@/app/(auth)/actions': { signOut: () => {} },
    '@/features/identity/viewer-avatar': {
      ViewerAvatar: () => React.createElement('span', { className: 'avatar avatar-small' }, 'AR'),
    },
    '@/features/search/global-search': {
      GlobalSearch: () =>
        React.createElement('button', { className: 'global-search-trigger' }, 'Search workspace'),
    },
    '@/features/notifications/notification-link': {
      NotificationLink: () =>
        React.createElement(
          'a',
          { href: '/app/notifications', className: 'nav-link' },
          'Notifications · 3',
        ),
    },
    '@/lib/supabase/client': { createClient: () => ({}) },
    '@/features/lookups/labels': { profileLabels: async () => names },
    '@/features/lookups/lookup-select': {
      LookupSelect: () =>
        React.createElement(
          'label',
          { className: 'field' },
          'Assigned technician',
          React.createElement(
            'select',
            { className: 'input', defaultValue: 'Alex Rivera' },
            React.createElement('option', null, 'Alex Rivera'),
          ),
        ),
    },
    '@/components/ui/action-form': {
      ActionForm: ({ children, ...props }) => {
        delete props.action;
        return React.createElement('form', props, children);
      },
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children, ...props }) =>
        React.createElement('button', { ...props, type: 'button' }, children),
    },
    '@/app/app/chat/actions': Object.fromEntries(
      ['assignChat', 'closeChat', 'convertChatToTicket', 'linkChatToTicket', 'startChat'].map(
        (key) => [key, () => {}],
      ),
    ),
  };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    const width = url.searchParams.get('width') || '100%';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      `<body style="margin:0;font:14px system-ui;background:#e5e7eb"><nav style="padding:12px"><a href="/?width=100%">Desktop</a> · <a href="/?width=900px">Tablet</a> · <a href="/?width=390px">Mobile</a> · <a href="/?width=640px">200% reflow</a> · <a href="/?personal=1&width=390px">Employee</a> · <a href="/?dark=1">Dark</a> · <a href="/?inbox=1&width=390px">Mobile inbox</a></nav><iframe title="Chat center preview" style="display:block;border:0;width:${width};max-width:100%;height:1100px;margin:auto" src="/chat?${url.searchParams}"></iframe>`,
    );
    return;
  }
  if (url.pathname === '/chat') {
    const personal = url.searchParams.has('personal');
    const mock = mocks(personal, url.searchParams.has('media'));
    const file = url.searchParams.has('inbox')
      ? 'src/app/app/chat/page.tsx'
      : 'src/app/app/chat/[conversationId]/page.tsx';
    const Page = load(file, mock).default;
    const Layout = load('src/app/app/layout.tsx', mock).default;
    let shell = renderToStaticMarkup(
      await Layout({
        children: await Page({
          params: Promise.resolve({ conversationId: 'chat-1' }),
          searchParams: Promise.resolve({}),
        }),
      }),
    );
    if (url.searchParams.has('details'))
      shell = shell.replace(
        '<details class="chat-context">',
        '<details class="chat-context" open>',
      );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      `<!doctype html><html lang="en" ${url.searchParams.has('dark') ? 'data-theme="dark"' : ''}><head><meta charset="utf-8"><style>@font-face{font-family:Outfit;src:url('/public/brand/fixxflow/fonts/Outfit-Variable.ttf');font-weight:100 900}@font-face{font-family:RethinkSans;src:url('/public/brand/fixxflow/fonts/RethinkSans-Variable.ttf');font-weight:400 800}:root{--font-outfit:Outfit;--font-rethink-sans:RethinkSans}</style><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/app/globals.css"><title>Chat center · local preview</title></head><body>${shell}</body></html>`,
    );
    return;
  }
  if (url.pathname === '/sample.wav') {
    const bytes = Buffer.alloc(16044);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(16036, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24);
    bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(16000, 40);
    res.setHeader('Content-Type', 'audio/wav');
    res.end(bytes);
    return;
  }
  const target = path.resolve(
    url.pathname.startsWith('/brand/') ? 'public' + url.pathname : '.' + url.pathname,
  );
  if (
    target.startsWith(process.cwd() + path.sep) &&
    fs.existsSync(target) &&
    fs.statSync(target).isFile()
  ) {
    res.setHeader(
      'Content-Type',
      target.endsWith('.css')
        ? 'text/css'
        : target.endsWith('.ttf')
          ? 'font/ttf'
          : 'application/octet-stream',
    );
    res.end(fs.readFileSync(target));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});
server.listen(8768, '127.0.0.1', () => console.log('Chat fixture: http://127.0.0.1:8768'));
