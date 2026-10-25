import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';
import { searchNavigation } from '../../../tests/helpers/search-navigation.mjs';

const { ArticleContent } = load('src/features/knowledge/article-content.tsx');
test('rich text is rendered semantically and raw HTML is escaped', () => {
  const html = renderToStaticMarkup(
    React.createElement(ArticleContent, {
      content: [
        { type: 'heading', text: 'Steps' },
        { type: 'paragraph', text: '**Bold** and *italic* <script>alert(1)</script>' },
        { type: 'list', text: 'First\nSecond' },
      ],
    }),
  );
  assert.match(html, /<h2>Steps<\/h2>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<ul><li>First/);
  assert.doesNotMatch(html, /<script>/);
});
test('image sources only come from authorized asset mapping and retain alt text', () => {
  const id = '10000000-0000-0000-0000-000000000001';
  const html = renderToStaticMarkup(
    React.createElement(ArticleContent, {
      content: [
        { type: 'image', text: 'Network settings', assetId: id, url: 'https://tracking.test' },
      ],
      images: { [id]: '/app/help/assets/' + id },
    }),
  );
  assert.match(html, /alt="Network settings"/);
  assert.doesNotMatch(html, /tracking.test/);
});
test('employee article edits are rejected before database access', async () => {
  const { saveArticle } = load('src/app/app/help/actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth/viewer': { requireViewer: async () => ({ role: 'end_user' }) },
    '@/lib/supabase/server': {
      createClient: () => {
        throw Error('Must not query');
      },
    },
    '@/features/knowledge/content': load('src/features/knowledge/content.ts'),
  });
  assert.match((await saveArticle(new FormData())).error, /Only IT/);
});
test('article editor uses labeled native controls and keyboard block ordering', () => {
  const { ArticleEditor } = load('src/features/knowledge/article-editor.tsx', {
    'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) },
    '@/app/app/help/actions': { saveArticle: async () => ({}) },
    '@/lib/supabase/client': { createClient: () => ({}) },
    './article-content': { ArticleContent: () => null },
  });
  const html = renderToStaticMarkup(
    React.createElement(ArticleEditor, {
      article: {
        id: '10000000-0000-0000-0000-000000000001',
        title: 'Draft',
        summary: '',
        category: 'Network',
        status: 'draft',
        revision: 1,
        content: [{ type: 'paragraph', text: 'Example' }],
        related_article_ids: [],
      },
      organizationId: 'org',
      assets: [],
      related: [],
      isNew: true,
    }),
  );
  assert.match(html, /Draft — IT staff only/);
  assert.match(html, /aria-label="Move block 1 up"/);
  assert.match(html, /<legend>Write your article<\/legend>/);
  assert.match(html, /Create article/);
  assert.match(html, /Save your article to add images and attachments/);
  assert.match(
    html,
    /<details class="progressive-section knowledge-related-disclosure"><summary>Related articles/,
  );
  assert.match(html, /<details class="settings-card progressive-section"><summary>Content preview/);
  assert.doesNotMatch(html, /<details[^>]*open=/);
});

test('published collection parses, covers all topics, and has valid related guides', () => {
  const collection = JSON.parse(fs.readFileSync('content/knowledge/general-it.json', 'utf8'));
  const { parseArticleContent, knowledgeCategories } = load('src/features/knowledge/content.ts');
  const keys = new Set(collection.articles.map((a) => a.key));
  assert.equal(keys.size, collection.articles.length);
  assert.deepEqual(
    new Set(collection.articles.map((a) => a.category)),
    new Set(knowledgeCategories),
  );
  for (const article of collection.articles) {
    assert.ok(
      article.title.length <= 180 && article.summary.length > 0 && article.summary.length <= 500,
    );
    assert.ok(parseArticleContent(article.content), article.key);
    assert.ok(article.content.some((b) => b.type === 'heading' && b.text === 'Check the result'));
    assert.ok(article.content.some((b) => b.type === 'heading' && b.text === 'When to contact IT'));
    assert.ok(
      article.related.length <= 8 &&
        article.related.every((key) => keys.has(key) && key !== article.key),
    );
    const html = renderToStaticMarkup(
      React.createElement(ArticleContent, { content: article.content, showContents: true }),
    );
    assert.doesNotMatch(html, /could not be displayed|<script>/);
  }
});

test('FixxFlow how-tos cover feature routes, identify audiences, and are reachable from getting started', () => {
  const collection = JSON.parse(fs.readFileSync('content/knowledge/general-it.json', 'utf8'));
  const guides = collection.articles.filter((article) => article.key.startsWith('fixxflow-'));
  const byKey = new Map(collection.articles.map((article) => [article.key, article]));
  const sources = new Set(guides.flatMap((article) => article.sourcePaths));
  for (const route of [
    'src/app/app/profile/page.tsx',
    'src/app/app/security/page.tsx',
    'src/app/app/notifications/page.tsx',
    'src/app/app/tickets/page.tsx',
    'src/app/app/tickets/new/page.tsx',
    'src/app/app/tickets/[ticketId]/history/page.tsx',
    'src/app/app/chat/page.tsx',
    'src/app/app/chat/[conversationId]/page.tsx',
    'src/app/app/help/page.tsx',
    'src/app/app/help/new/page.tsx',
    'src/app/app/assets/page.tsx',
    'src/app/app/assets/import/page.tsx',
    'src/app/app/inventory/page.tsx',
    'src/app/app/people/page.tsx',
    'src/app/app/organization/page.tsx',
    'src/app/app/reports/page.tsx',
    'src/app/app/administration/[section]/page.tsx',
    'src/app/app/administration/automations/[ruleId]/page.tsx',
    'src/app/app/administration/automations/operations/page.tsx',
    'src/app/platform/customers/page.tsx',
    'src/app/platform/analytics/page.tsx',
    'src/app/platform/audit/page.tsx',
  ])
    assert.ok(sources.has(route), `Missing how-to coverage: ${route}`);
  for (const article of guides) {
    assert.ok(
      ['employees', 'it_only'].includes(article.audience) &&
        article.content[0].text.includes(article.intendedReaders),
      article.key,
    );
    assert.match(article.reviewedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(
      article.sourcePaths.length > 0 && article.sourcePaths.every((path) => fs.existsSync(path)),
      article.key,
    );
  }
  const reachable = new Set(),
    pending = ['fixxflow-start'];
  while (pending.length) {
    const key = pending.pop();
    if (reachable.has(key)) continue;
    reachable.add(key);
    pending.push(...byKey.get(key).related);
  }
  for (const article of guides)
    assert.ok(reachable.has(article.key), `Unreachable how-to: ${article.key}`);
});
test('article contents links resolve to unique focusable headings, including repeated titles', () => {
  const html = renderToStaticMarkup(
    React.createElement(ArticleContent, {
      showContents: true,
      content: [
        { type: 'heading', text: 'Check' },
        { type: 'paragraph', text: 'Details' },
        { type: 'heading', text: 'Check' },
      ],
    }),
  );
  assert.match(html, /aria-label="On this page"/);
  for (const id of ['article-section-0', 'article-section-2']) {
    assert.match(html, new RegExp(`href="#${id}"`));
    assert.match(html, new RegExp(`id="${id}" tabindex="-1"`));
  }
});
test('knowledge import is explicitly scoped and uses stable organization-specific article IDs', async () => {
  const { buildImport, articleId } = await import('../../../scripts/knowledge-import.mjs');
  const collection = JSON.parse(fs.readFileSync('content/knowledge/general-it.json', 'utf8'));
  const org = '20000000-0000-0000-0000-000000000001';
  assert.equal(articleId(org, 'wifi'), articleId(org, 'wifi'));
  assert.notEqual(
    articleId(org, 'wifi'),
    articleId('20000000-0000-0000-0000-000000000002', 'wifi'),
  );
  assert.throws(() => buildImport(collection, org, "bad';slug"));
  assert.throws(() => buildImport(collection, '', ''));
  const sql = buildImport(collection, org, 'my-org');
  assert.match(sql, /Organization identity does not match/);
  assert.match(sql, /knowledge_import_created/);
  assert.doesNotMatch(sql, /delete from|on conflict.*do update/i);
});

async function renderHelp({ role = 'end_user', filters = {}, data = [], error = null } = {}) {
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    or() {
      return this;
    },
    range: async () => ({ data, error }),
  };
  const { default: Page } = load('src/app/app/help/page.tsx', {
    'next/navigation': searchNavigation,
    'next/link': { default: (props) => React.createElement('a', props) },
    '@/features/product-analytics/usage-event': { UsageEvent: () => null },
    '@/features/knowledge/content': load('src/features/knowledge/content.ts'),
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ role, organizationId: 'org', usageSharing: false }),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({ from: () => query, rpc: () => query }),
    },
  });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(filters) }));
}
test('help browsing exposes labeled topic links and a useful empty state to employees', async () => {
  const html = await renderHelp();
  assert.match(html, /aria-label="Browse help topics"/);
  assert.match(html, /href="\/app\/help\?category=Security"/);
  assert.match(html, /No published guides yet/);
  assert.match(html, /Submit a request/);
  assert.doesNotMatch(html, /New article|All, including drafts/);
});
test('filtered results, empty searches, and failures preserve recovery paths', async () => {
  const filtered = await renderHelp({ filters: { q: 'printer' } });
  assert.doesNotMatch(filtered, /Browse help topics/);
  assert.match(filtered, /No articles found/);
  const error = await renderHelp({ error: { message: 'offline' } });
  assert.match(error, /role="alert"/);
  assert.match(error, /Try again/);
  assert.doesNotMatch(error, /No published guides yet/);
  const staff = await renderHelp({ role: 'administrator', filters: { view: 'all' } });
  assert.match(staff, /category=Security&amp;view=all/);
  assert.match(staff, /New article/);
});

test('staff can filter by audience while employees see a simpler knowledge base', async () => {
  const staff = await renderHelp({
    role: 'technician',
    filters: { audience: 'it_only', view: 'all' },
    data: [
      {
        id: 'guide',
        title: 'Internal procedure',
        summary: 'Steps',
        category: 'Network',
        status: 'published',
        audience: 'it_only',
      },
    ],
  });
  assert.match(staff, /Audience<select/);
  assert.match(staff, /IT only/);
  assert.match(staff, /category=Security&amp;view=all&amp;audience=it_only/);
  const employee = await renderHelp({ filters: { audience: 'it_only' } });
  assert.doesNotMatch(employee, /Audience<select|All audiences|IT only/);
});

test('saving articles requires a valid audience and persists the selected audience', async () => {
  const saved = [];
  const id = '10000000-0000-0000-0000-000000000001';
  const query = {
    insert(value) {
      saved.push(value);
      return this;
    },
    select() {
      return this;
    },
    single: async () => ({ data: { id }, error: null }),
  };
  const { saveArticle } = load('src/app/app/help/actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ role: 'technician', id: 'worker', organizationId: 'org' }),
    },
    '@/lib/supabase/server': { createClient: async () => ({ from: () => query }) },
  });
  const form = () =>
    new Map(
      Object.entries({
        id,
        title: 'Helpful guide',
        summary: 'Steps',
        category: 'Network',
        status: 'published',
        content: JSON.stringify([{ type: 'paragraph', text: 'Instructions' }]),
        new: 'true',
      }),
    );
  // FormData semantics include an empty related-article selection.
  const data = () => {
    const value = form();
    value.getAll = () => [];
    return value;
  };
  assert.match((await saveArticle(data())).error, /audience/);
  assert.equal(saved.length, 0);
  for (const audience of ['employees', 'it_only']) {
    const value = data();
    value.set('audience', audience);
    assert.equal((await saveArticle(value)).id, id);
    assert.equal(saved.at(-1).audience, audience);
  }
});

test('reviewed catalog explicitly separates employee guides from operational procedures', () => {
  const collection = JSON.parse(fs.readFileSync('content/knowledge/general-it.json', 'utf8'));
  const review = JSON.parse(fs.readFileSync('docs/knowledge-audience-review.json', 'utf8'));
  assert.equal(review.articles.length, 70);
  assert.equal(review.articles.filter((a) => a.audience === 'employees').length, 42);
  assert.equal(review.articles.filter((a) => a.audience === 'it_only').length, 28);
  for (const article of collection.articles) {
    assert.equal(
      article.audience,
      review.articles.find((a) => a.title === article.title)?.audience,
      article.title,
    );
    if (
      article.intendedReaders &&
      /administrator|technician|platform owner|inventory manager/i.test(article.intendedReaders)
    )
      assert.equal(article.audience, 'it_only', article.title);
  }
});
