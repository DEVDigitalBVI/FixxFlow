import 'server-only';

import type { InvitationResult } from '@/features/administration/bulk-invite-model';
import { parseNotificationEmailConfiguration } from '@/features/notifications/configuration';
import { renderEmail } from '@/features/notifications/template';
import type { createAdminClient } from '@/lib/supabase/admin';
import { isObjectRecord } from '@/lib/validation';

import { invitationToken, invitationTokenHash } from './invitation-token';

export async function sendWorkspaceInvitation(
  {
    admin,
    org,
    userId,
    actor,
    invitationId,
    workspaceName,
    inviterName,
  }: {
    admin: ReturnType<typeof createAdminClient>;
    org: string;
    userId: string;
    actor: string;
    invitationId: string;
    workspaceName: string;
    inviterName: string;
  },
  environment: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): Promise<InvitationResult> {
  const config = {
    apiKey: environment.RESEND_API_KEY ?? '',
    from: environment.NOTIFICATIONS_FROM_EMAIL ?? '',
    siteUrl: environment.NEXT_PUBLIC_SITE_URL ?? '',
  };
  const secret = environment.SUPABASE_SECRET_KEY ?? '';
  let raw: string;
  try {
    if (!config.apiKey) throw Error();
    parseNotificationEmailConfiguration(config);
    raw = invitationToken(invitationId, secret);
  } catch {
    return { error: 'Invitation email is not configured. Contact your workspace administrator.' };
  }
  const hash = invitationTokenHash(raw);
  const { data, error } = await admin.rpc('issue_workspace_invitation', {
    org,
    member: userId,
    actor,
    token: invitationId,
    token_hash: hash,
  });
  if (error?.code === 'PT409')
    return { success: 'This account is already set up. Use sign in or password recovery.' };
  if (error?.code === 'PT429')
    return {
      rateLimited: true,
      error: 'Wait one minute before sending another invitation. Your entries are preserved.',
    };
  if (error?.code === 'PT410')
    return { error: 'This invitation has expired. Use Send new invitation in People.' };
  if (
    error ||
    !isObjectRecord(data) ||
    typeof data.email !== 'string' ||
    typeof data.expiresAt !== 'string' ||
    typeof data.sent !== 'boolean'
  )
    return {
      error: 'The invitation could not be prepared. Your entries are preserved; try again.',
    };
  if (data.sent)
    return {
      success:
        'This invitation email was already accepted by the email service. It is valid for 72 hours from the original send.',
    };
  const href = new URL('/auth/invitation', config.siteUrl);
  href.searchParams.set('id', invitationId);
  href.searchParams.set('token', raw);
  const message = `${inviterName} invited you to join ${workspaceName} in FixxFlow. Accept your invitation and choose a password.`;
  const note =
    'This invitation is valid for 72 hours. It can be used once. If it expires, ask your workspace administrator for a new invitation.';
  try {
    const response = await request('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(4000),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `workspace-invitation/${invitationId}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [data.email],
        subject: 'You are invited to FixxFlow',
        text: `${message}\n\n${note}\n\nAccept invitation:\n${href.href}`,
        html: await renderEmail({
          title: 'You are invited to FixxFlow',
          message,
          note,
          action: 'Accept invitation',
          href: href.href,
          purpose: 'workspace',
          workspaceName,
          siteUrl: config.siteUrl,
        }),
      }),
    });
    if (response.status === 429)
      return {
        rateLimited: true,
        error:
          'The email service is limiting requests. Your invitation is preserved; retry shortly.',
      };
    if (!response.ok) throw Error();
    const result: unknown = await response.json();
    if (!isObjectRecord(result) || typeof result.id !== 'string' || !result.id) throw Error();
    const saved = await admin.rpc('mark_workspace_invitation_sent', {
      invitation: invitationId,
      hash,
      receipt: result.id,
    });
    if (saved.error)
      return {
        error:
          'The email service accepted the invitation, but confirmation could not be saved. Retry with this form to repair it without sending a duplicate.',
      };
    return {
      success: 'Invitation email accepted. The recipient has 72 hours to finish account setup.',
    };
  } catch {
    return {
      error:
        'We could not confirm the invitation email. Your entries are preserved; retry with this form to check safely.',
    };
  }
}
