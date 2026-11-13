'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { saveArticle } from '@/app/app/help/actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { revealField } from '@/components/ui/reveal-field';
import { confirmDiscardChanges, useUnsavedChanges } from '@/components/ui/unsaved-changes';
import { createClient } from '@/lib/supabase/client';
import { uploadAndRegister } from '@/lib/uploads';
import type { KnowledgeArticle, KnowledgeAsset } from '@/types/database';

import { articleAssetTypes, renderArticleAssets } from './article-assets';
import { renderArticleBlocksEditor } from './article-blocks-editor';
import { ArticleContent } from './article-content';
import { renderArticlePublication } from './article-publication';
import { type KnowledgeAudience } from './audience';
import { parseArticleContent, type ArticleBlock } from './content';
import { RelatedArticlePicker } from './related-article-picker';

export function ArticleEditor({
  article,
  organizationId,
  assets: initialAssets,
  related,
  isNew = false,
  library = false,
  saveAction = saveArticle,
}: {
  article: KnowledgeArticle;
  organizationId: string;
  assets: KnowledgeAsset[];
  related: { id: string; title: string; audience?: import('./audience').KnowledgeAudience }[];
  isNew?: boolean;
  library?: boolean;
  saveAction?: typeof saveArticle;
}) {
  const router = useRouter();
  const [revision] = useState(article.revision);
  const [metadata, setMetadata] = useState({
    title: article.title,
    category: article.category,
    summary: article.summary ?? '',
    status: article.status,
    helpTopic: article.help_topic ?? 'getting-started',
    helpFormat: article.help_format ?? 'guide',
  });
  const [collection, setCollection] = useState(article.help_collection ?? 'knowledge');
  const [audience, setAudience] = useState<KnowledgeAudience>(article.audience);
  const [blocks, setBlocks] = useState<ArticleBlock[]>(parseArticleContent(article.content) ?? []);
  const [assets, setAssets] = useState(initialAssets);
  const [error, setError] = useState('');
  const [busy, startTransition] = useTransition();
  const saveInFlight = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const textareas = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusParagraph = useRef<number | null>(null);
  useEffect(() => {
    if (focusParagraph.current !== null) {
      textareas.current[focusParagraph.current]?.focus();
      focusParagraph.current = null;
    }
  }, [blocks]);
  const releaseDraft = useUnsavedChanges(dirty);
  const update = (index: number, patch: Partial<ArticleBlock>) => {
    setDirty(true);
    setBlocks((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const format = (index: number, marker: string) => {
    const area = textareas.current[index];
    if (!area) return;
    const start = area.selectionStart,
      end = area.selectionEnd,
      text = blocks[index].text;
    update(index, {
      text:
        text.slice(0, start) +
        marker +
        (text.slice(start, end) || 'text') +
        marker +
        text.slice(end),
    });
    area.focus();
  };
  async function submit(form: FormData) {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setError('');
    form.set('content', JSON.stringify(blocks));
    try {
      const result = await saveAction(form);
      if (result.error || !result.id) {
        setError(result.error ?? 'Could not save.');
        requestAnimationFrame(() => errorRef.current?.focus());
      } else {
        releaseDraft();
        setDirty(false);
        router.push(
          library
            ? `/platform/library?saved=${result.id}`
            : `/app/help/${result.id}${isNew ? '/edit' : ''}`,
        );
        router.refresh();
      }
    } catch {
      setError('Could not save. Your work is still here; please retry.');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      saveInFlight.current = false;
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!articleAssetTypes.includes(file.type) || file.size === 0 || file.size > 6 * 1024 * 1024) {
      setUploadMessage('Use a JPG, PNG, WebP, PDF, text, Word, or Excel file up to 6 MB.');
      return;
    }
    setUploading(true);
    setUploadMessage('');
    const database = createClient();
    const id = crypto.randomUUID();
    const storagePath = `${organizationId}/${article.id}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100)}`;
    try {
      const bucket = database.storage.from('knowledge-assets');
      let savedAsset: KnowledgeAsset | null = null;
      const result = await uploadAndRegister({
        upload: () => bucket.upload(storagePath, file, { contentType: file.type, upsert: false }),
        register: async () => {
          const saved = await database
            .from('knowledge_attachments')
            .insert({
              id,
              organization_id: organizationId,
              article_id: article.id,
              storage_path: storagePath,
              file_name: file.name.slice(0, 255),
              content_type: file.type,
              size_bytes: file.size,
            })
            .select('*')
            .single();
          savedAsset = saved.data;
          return {
            error:
              saved.error ??
              (!saved.data ? new Error('Registration could not be confirmed') : null),
          };
        },
        remove: () => bucket.remove([storagePath]),
      });
      if (result === 'saved' && savedAsset) {
        const asset = savedAsset;
        setAssets((items) => [...items, asset]);
        setUploadMessage('File added. Images are now available in image blocks.');
      } else if (result === 'unconfirmed') {
        setUploadMessage(
          'We could not confirm the file. Check the attachment list in a separate tab before retrying; your article changes are still here.',
        );
      } else setUploadMessage('Upload failed. Please select the file again to retry.');
    } catch {
      setUploadMessage('Upload failed. Please select the file again to retry.');
    } finally {
      setUploading(false);
    }
  }
  const images = Object.fromEntries(
    assets
      .filter((a) => a.content_type.startsWith('image/'))
      .map((a) => [a.id, `/app/help/assets/${a.id}`]),
  );
  return (
    <div className="knowledge-editor">
      <form
        method="post"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          // React form actions reset native controls even after handled errors.
          // Keep submission under our control so the entire failed draft survives.
          return startTransition(() => submit(form));
        }}
        onChange={() => setDirty(true)}
        onInvalidCapture={(event) => revealField(event.target as HTMLElement)}
      >
        <input type="hidden" name="id" value={article.id} />
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="new" value={String(isNew)} />
        {error && (
          <Alert ref={errorRef} tabIndex={-1} as="p" tone="error" role="alert">
            {error}
          </Alert>
        )}
        <fieldset disabled={busy}>
          <legend>Article details</legend>
          <label>
            Title
            <Input
              name="title"
              value={metadata.title}
              onChange={(event) => setMetadata({ ...metadata, title: event.target.value })}
              required
              minLength={3}
              maxLength={180}
            />
          </label>
        </fieldset>
        {renderArticleBlocksEditor({
          busy,
          blocks,
          assets,
          library,
          format,
          update,
          textareasRef: textareas,
          focusParagraphRef: focusParagraph,
          setDirty,
          setBlocks,
        })}
        {renderArticlePublication({
          busy,
          library,
          collection,
          metadata,
          audience,
          setDirty,
          setCollection,
          setMetadata,
          setAudience,
        })}
        <details className="progressive-section knowledge-related-disclosure">
          <summary>
            Related articles <span className="muted">Optional</span>
          </summary>
          <fieldset disabled={busy}>
            <legend className="sr-only">Related articles</legend>
            <RelatedArticlePicker
              articleId={article.id}
              library={library}
              initial={related.filter((item) => article.related_article_ids.includes(item.id))}
            />
          </fieldset>
        </details>
        <div className="knowledge-actions">
          <Button variant="primary" disabled={busy || uploading}>
            {busy ? 'Saving…' : isNew ? 'Create article' : 'Save article'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (!dirty || confirmDiscardChanges())
                router.push(
                  library ? '/platform/library' : isNew ? '/app/help' : `/app/help/${article.id}`,
                );
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
      {renderArticleAssets({ library, isNew, busy, uploading, uploadMessage, assets, upload })}
      <details className="settings-card progressive-section">
        <summary>Content preview</summary>
        <ArticleContent content={blocks} images={images} />
      </details>
    </div>
  );
}
