export function safeQueueReturn(value?: string) {
  if (!value || value.length > 2000) return '/app/tickets';
  try {
    const url = new URL(value, 'https://fixxflow.invalid');
    if (url.origin !== 'https://fixxflow.invalid' || url.pathname !== '/app/tickets')
      return '/app/tickets';
    url.searchParams.delete('ticket');
    return url.pathname + url.search;
  } catch {
    return '/app/tickets';
  }
}
export function ticketDetailHref(id: string, returnTo: string) {
  return `/app/tickets/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: safeQueueReturn(returnTo) })}`;
}
