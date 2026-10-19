import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** URL encoding and React HTML escaping protect their separate parser contexts. */
export function renderCompactPreview(params) {
  const suppliedWidth = Number(params.get('width'));
  const width = Number.isFinite(suppliedWidth) && suppliedWidth > 0 ? suppliedWidth : 390;
  const role = params.get('role') || '', theme = params.get('theme') || 'light';
  const query = new URLSearchParams({ view: 'all', role, theme, surface: params.get('surface') || '' });
  return '<!doctype html>' + renderToStaticMarkup(h('html', { lang: 'en' },
    h('head', null, h('title', null, 'Interface audit viewport')),
    h('body', null, h('h1', null, `${width}px ${role} ${theme} fixture`),
      h('iframe', { title: 'Audit viewport', src: `/app/tickets?${query}`, style: { width, height: 850, border: '1px solid gray' } }))));
}
