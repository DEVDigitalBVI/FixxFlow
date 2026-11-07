import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CopyTextButton } from '@/components/ui/copy-text-button';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableRegion } from '@/components/ui/table';
import {
  getInboundEmailConfiguration,
  inboundAddress,
} from '@/features/notifications/configuration';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Email to ticket' };

const outcomes: Record<string, string> = {
  ticket_created: 'Ticket created',
  reply_added: 'Reply added',
  note_added: 'Internal note added (staff reply)',
  rejected_sender: 'Rejected · sender is not an active member',
  rejected_unauthenticated: 'Rejected · sender could not be verified (DMARC)',
  rejected_ticket: 'Rejected · sender cannot reply to that ticket',
};

export default async function EmailToTicketPage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  const inbound = getInboundEmailConfiguration(process.env);
  const supabase = await createClient();
  const [organization, log] = await Promise.all([
    supabase.from('organizations').select('slug').eq('id', viewer.organizationId).single(),
    supabase
      .from('inbound_emails')
      .select(
        'id, sender, subject, status, ticket_id, created_at, attachment_status, imported_attachments, skipped_attachments',
      )
      .eq('organization_id', viewer.organizationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(50),
  ]);
  const address =
    inbound && organization.data ? inboundAddress(organization.data.slug, inbound.domain) : null;
  return (
    <div className="page stack">
      <PageHeader
        title="Email to ticket"
        description="Members email your workspace address to create tickets or reply to them."
        back={{ href: '/app/administration#admin-support', label: 'Settings' }}
      />
      <section className="settings-card stack" aria-labelledby="inbound-address-heading">
        <h2 id="inbound-address-heading">Your workspace address</h2>
        {address ? (
          <>
            <p className="inbound-address">
              <code>{address}</code>
              <CopyTextButton text={address} />
            </p>
            <p className="muted">
              Share this address with employees, or forward your own IT mailbox (such as
              it@yourcompany.com) to it.
            </p>
          </>
        ) : (
          <p role="status">
            Email to ticket is not switched on for FixxFlow yet. Contact FixxFlow support to enable
            it.
          </p>
        )}
        <p>
          <strong>Reply visibility:</strong> employee replies are public; IT staff email replies and
          attachments are internal. Use the ticket’s Respond step to send a public staff reply.
        </p>
        <details>
          <summary>How email processing works</summary>
          <ul className="inbound-rules">
            <li>Only active members of this workspace can create or reply to tickets by email.</li>
            <li>
              The sender’s address must pass email authentication (DMARC), so forged “From”
              addresses are rejected.
            </li>
            <li>
              Notification emails include the ticket number, such as [#1042], in the subject.
              Replying adds a public reply from the requester, or an internal note from IT staff.
            </li>
            <li>
              Email thread headers keep follow-up messages on the original ticket. A subject-only
              reply to a closed ticket creates a follow-up request.
            </li>
            <li>
              Attached PNG, JPEG, WebP, PDF, TXT and LOG files are processed in the background (10
              MB per file, 20 MB per email, up to 20 files). Inline signature images and unsupported
              files are skipped. Staff email attachments remain internal.
            </li>
          </ul>
        </details>
      </section>
      <section className="settings-card stack" aria-labelledby="inbound-log-heading">
        <h2 id="inbound-log-heading">Recent messages</h2>
        {log.error ? (
          <p role="alert">Recent messages could not load. Refresh to try again.</p>
        ) : log.data.length ? (
          <TableRegion role="region" aria-label="Recent inbound messages" tabIndex={0}>
            <Table>
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">From</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {log.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Timestamp value={row.created_at} />
                    </td>
                    <td>{row.sender || 'Unknown sender'}</td>
                    <td>{row.subject || '(No subject)'}</td>
                    <td>
                      {outcomes[row.status] ?? row.status}
                      {row.attachment_status !== 'none' && (
                        <p className="muted">
                          Files: {row.attachment_status} · {row.imported_attachments} imported ·{' '}
                          {row.skipped_attachments} skipped
                        </p>
                      )}
                      {row.ticket_id && (
                        <>
                          {' · '}
                          <Link href={`/app/tickets/${row.ticket_id}`}>Open ticket</Link>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableRegion>
        ) : (
          <p className="muted">
            No messages yet. Messages sent to your workspace address appear here.
          </p>
        )}
      </section>
    </div>
  );
}
