import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { profileLabels } from '@/features/lookups/labels';
import { SavedReplyEditor } from '@/features/tickets/saved-reply-editor';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Saved replies' };

export default async function SavedRepliesPage() {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') notFound();
  const admin = viewer.role === 'administrator';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('saved_replies')
    .select('id, title, body, created_by, revision, updated_at')
    .eq('organization_id', viewer.organizationId)
    .order('title')
    .order('id')
    .limit(200);
  if (error) throw new Error('Saved replies could not load. Please try again.');
  const authors = new Map(
    (
      await profileLabels(
        supabase,
        viewer.organizationId,
        data.map((r) => r.created_by),
      )
    ).map((p) => [p.user_id, p.display_name]),
  );
  return (
    <div className="page stack">
      <PageHeader
        title="Saved replies"
        description="Reusable answers your IT team can insert into ticket replies and live chat, then edit before sending."
        back={
          admin
            ? { href: '/app/administration#admin-support', label: 'Settings' }
            : { href: '/app/tickets', label: 'Tickets' }
        }
      />
      <details className="settings-card" open={!data.length}>
        <summary>
          <strong>New saved reply</strong>
        </summary>
        <SavedReplyEditor />
      </details>
      <section className="settings-card stack" aria-labelledby="saved-replies-heading">
        <h2 id="saved-replies-heading">
          {data.length} saved {data.length === 1 ? 'reply' : 'replies'}
        </h2>
        <p className="muted">
          Everyone on your IT team can use these. The author or an administrator can edit or delete
          each one.
        </p>
        {data.length ? (
          <div className="management-list">
            {data.map((reply) => {
              const editable = admin || reply.created_by === viewer.id;
              return (
                <details className="settings-editor" key={reply.id}>
                  <summary>
                    <strong>{reply.title}</strong>
                    <span className="muted">
                      {authors.get(reply.created_by) ?? 'Former member'} · Updated{' '}
                      <Timestamp value={reply.updated_at} />
                    </span>
                  </summary>
                  {editable ? (
                    <SavedReplyEditor reply={reply} />
                  ) : (
                    <>
                      <p className="saved-reply-preview">{reply.body}</p>
                      <p className="muted">
                        Only the author or an administrator can edit this reply.
                      </p>
                    </>
                  )}
                </details>
              );
            })}
          </div>
        ) : (
          <p className="muted">
            No saved replies yet. Add answers your team sends often, such as password reset steps or
            a request for more details.
          </p>
        )}
      </section>
    </div>
  );
}
