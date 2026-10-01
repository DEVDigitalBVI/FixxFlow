import { unstable_rethrow } from 'next/navigation';
import { exportAutomation } from '@/features/automation/portable-service';
import { PortabilityError } from '@/features/automation/portable';

export async function GET(_request: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const result = await exportAutomation((await params).ruleId);
    return new Response(JSON.stringify(result.package, null, 2), { headers: {
      ...headers, 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    } });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: error instanceof PortabilityError ? error.message : 'Automation could not be exported. Return to the automation and try again.' }, { status: 400, headers });
  }
}
