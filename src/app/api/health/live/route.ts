export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store, max-age=0' };

export function GET() {
  return Response.json({ status: 'ok' }, { headers });
}
