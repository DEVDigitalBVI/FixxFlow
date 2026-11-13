'use client';

/** Open old wizard links and nested disclosures without unmounting drafts. */
export function followTicketHash(root: HTMLElement, hash: string) {
  const aliases: Record<string, string> = {
    'ticket-details': 'ticket-assignment',
  };
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return false;
  }
  if (!id) return false;
  const target = root.querySelector<HTMLElement>(`[id="${CSS.escape(aliases[id] ?? id)}"]`);
  if (!target) return false;
  let parent: HTMLElement | null = target;
  while (parent && parent !== root) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  const focus = target instanceof HTMLDetailsElement ? target.querySelector('summary') : target;
  if (focus instanceof HTMLElement) {
    if (!(target instanceof HTMLDetailsElement) && !focus.hasAttribute('tabindex'))
      focus.tabIndex = -1;
    focus.focus({ preventScroll: true });
    focus.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  return true;
}

/** Only a pending explicit hash may focus a late streamed target. */
export function observeTicketHash(root: HTMLElement, browser: Window, doc: Document) {
  let observer: MutationObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = '';
  const cancel = () => {
    observer?.disconnect();
    observer = undefined;
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = '';
  };
  const navigate = () => {
    cancel();
    const hash = browser.location.hash;
    if (!hash || followTicketHash(root, hash)) return;
    pending = hash;
    observer = new MutationObserver(() => {
      if (browser.location.hash !== pending) {
        cancel();
        return;
      }
      if (followTicketHash(root, pending)) cancel();
    });
    observer.observe(root, { childList: true, subtree: true });
    timer = setTimeout(cancel, 10000);
  };
  // If the worker starts another interaction, the old navigation no longer owns focus.
  const userMoved = () => cancel();
  const click = (event: MouseEvent) => {
    const target = event.target;
    const link = target instanceof Element ? target.closest('a[href^="#"]') : null;
    if (link?.getAttribute('href') === browser.location.hash) navigate();
  };
  navigate();
  browser.addEventListener('hashchange', navigate);
  doc.addEventListener('click', click);
  root.addEventListener('pointerdown', userMoved);
  root.addEventListener('keydown', userMoved);
  return () => {
    cancel();
    browser.removeEventListener('hashchange', navigate);
    doc.removeEventListener('click', click);
    root.removeEventListener('pointerdown', userMoved);
    root.removeEventListener('keydown', userMoved);
  };
}
