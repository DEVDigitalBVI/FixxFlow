type RequestDetails = { method: string };
type RequestContext = { routePath: string; routeType: string };

const methods = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
const routeTypes = new Set(['action', 'proxy', 'render', 'route']);

function safeRoute(value: string) {
  return value.length <= 200 && /^\/[A-Za-z0-9_./[\]()-]*$/.test(value) ? value : 'unknown';
}

/** Log only allowlisted request metadata. Never serialize errors, URLs, headers, bodies, cookies, or user data. */
export function reportUncaughtRequestError(
  _error: unknown,
  request: RequestDetails,
  context: RequestContext,
) {
  const event = {
    event: 'request.failure',
    code: 'UNEXPECTED',
    correlationId: globalThis.crypto.randomUUID(),
    method: methods.has(request.method) ? request.method : 'OTHER',
    route: safeRoute(context.routePath),
    routeType: routeTypes.has(context.routeType) ? context.routeType : 'unknown',
  };
  console.error(JSON.stringify(event));
  return event.correlationId;
}
