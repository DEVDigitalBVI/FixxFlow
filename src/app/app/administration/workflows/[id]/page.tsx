import Link from 'next/link';
import { notFound } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { RetryButton } from '@/components/ui/retry-button';
import { isUuid } from '@/features/tickets/communications';
import { Timestamp } from '@/features/timezones/provider';
import { DefinitionPreview } from '@/features/workflows/definition-preview';
import { TemplateBuilder } from '@/features/workflows/template-builder';
import { TemplateCommand } from '@/features/workflows/template-controls';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const viewer = await requireViewer(),
    { id } = await params,
    { before } = await searchParams;
  if (viewer.role !== 'administrator' || !isUuid(id)) notFound();
  const db = await createClient();
  const [templateR, draftR] = await Promise.all([
    db
      .from('workflow_templates')
      .select('*')
      .eq('organization_id', viewer.organizationId)
      .eq('id', id)
      .maybeSingle(),
    db
      .from('workflow_template_drafts')
      .select('*')
      .eq('organization_id', viewer.organizationId)
      .eq('template_id', id)
      .maybeSingle(),
  ]);
  if (templateR.error || draftR.error)
    return (
      <div className="page">
        <p role="alert">
          The template could not load. <RetryButton />
        </p>
      </div>
    );
  if (!templateR.data || !draftR.data) notFound();
  const template = templateR.data,
    draft = draftR.data;
  let versionsQuery = db
    .from('workflow_template_versions')
    .select('*')
    .eq('organization_id', viewer.organizationId)
    .eq('template_id', id);
  if (before && /^\d{1,9}$/.test(before))
    versionsQuery = versionsQuery.lt('version', Number(before));
  const versions = await versionsQuery.order('version', { ascending: false }).limit(21),
    rows = (versions.data ?? []).slice(0, 20);
  return (
    <div className="page page-narrow">
      <PageHeader
        title={draft.definition.name}
        eyebrow="Company workflow template"
        description={`${template.archived ? 'Archived · ' : ''}${template.latest_version ? `Latest published version ${template.latest_version}` : 'Draft only'}`}
        back={{ href: '/app/administration/workflows', label: 'Back to templates' }}
        actions={
          template.latest_version > 0 && !template.archived ? (
            <Link
              className={buttonVariants({ variant: 'secondary' })}
              href={`/app/workflows/${id}`}
            >
              View published procedure
            </Link>
          ) : undefined
        }
      />
      {!template.archived && (
        <section className="settings-card stack">
          <h2>Edit draft</h2>
          <TemplateBuilder
            templateId={id}
            revision={template.revision}
            initial={draft.definition}
          />
        </section>
      )}
      <section className="settings-card stack">
        <h2>Saved draft review</h2>
        <p className="muted">
          Saved <Timestamp value={draft.updated_at} />. Publishing uses these saved details. Unsaved
          edits above are not included.
        </p>
        <DefinitionPreview definition={draft.definition} />
        {!template.archived && (
          <TemplateCommand templateId={id} revision={template.revision} operation="publish" />
        )}
      </section>
      <section className="settings-card stack">
        <h2>Published versions</h2>
        {versions.error ? (
          <p role="alert">
            Version history could not load. <RetryButton />
          </p>
        ) : (
          <>
            {!rows.length && <p>No published versions on this page.</p>}
            <ul className="response-checklist">
              {rows.map((v) => (
                <li key={v.version}>
                  <details>
                    <summary>
                      Version {v.version} · {v.definition.name}
                    </summary>
                    <p className="muted">
                      Published <Timestamp value={v.published_at} />
                    </p>
                    <p className="ticket-description">{v.change_note}</p>
                    <DefinitionPreview definition={v.definition} />
                  </details>
                </li>
              ))}
            </ul>
            {(before || (versions.data?.length ?? 0) > 20) && (
              <nav className="section-heading-row" aria-label="Published version pages">
                {before && (
                  <Link
                    className={buttonVariants({ variant: 'secondary' })}
                    href={`/app/administration/workflows/${id}`}
                  >
                    Latest versions
                  </Link>
                )}
                {(versions.data?.length ?? 0) > 20 && (
                  <Link
                    className={buttonVariants({ variant: 'secondary' })}
                    href={`/app/administration/workflows/${id}?before=${rows.at(-1)!.version}`}
                  >
                    Earlier versions
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </section>
      <section className="settings-card">
        <details>
          <summary>{template.archived ? 'Restore template' : 'Archive template'}</summary>
          <TemplateCommand
            templateId={id}
            revision={template.revision}
            operation={template.archived ? 'restore' : 'archive'}
          />
        </details>
      </section>
    </div>
  );
}
