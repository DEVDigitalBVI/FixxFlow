'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { saveArticle } from '@/app/app/help/actions';
import { revealField } from '@/components/ui/reveal-field';
import { confirmDiscardChanges, useUnsavedChanges } from '@/components/ui/unsaved-changes';
import { createClient } from '@/lib/supabase/client';
import { uploadAndRegister } from '@/lib/uploads';
import type { KnowledgeArticle, KnowledgeAsset } from '@/types/database';

import { ArticleContent } from './article-content';
import { knowledgeAudiences, type KnowledgeAudience } from './audience';
import { blockTypes, knowledgeCategories, parseArticleContent, type ArticleBlock } from './content';

const assetTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
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
  const [audience, setAudience] = useState<KnowledgeAudience>(article.audience);
  const [blocks, setBlocks] = useState<ArticleBlock[]>(parseArticleContent(article.content) ?? []);
  const [assets, setAssets] = useState(initialAssets);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!assetTypes.includes(file.type) || file.size === 0 || file.size > 6 * 1024 * 1024) {
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
        action={submit}
        onChange={() => setDirty(true)}
        onInvalidCapture={(event) => revealField(event.target as HTMLElement)}
      >
        <input type="hidden" name="id" value={article.id} />
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="new" value={String(isNew)} />
        {error && (
          <p ref={errorRef} tabIndex={-1} className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy}>
          <legend>Article details</legend>
          <label>
            Title
            <input
              className="input"
              name="title"
              defaultValue={article.title}
              required
              minLength={3}
              maxLength={180}
            />
          </label>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Write your article</legend>
          <p className="muted">
            Start with the answer, then explain the steps. Use Bold and Italic to format selected
            text.
          </p>
          {blocks.map((block, i) => (
            <fieldset className="knowledge-block" key={i}>
              <legend>
                {block.type === 'paragraph'
                  ? 'Paragraph'
                  : block.type[0].toUpperCase() + block.type.slice(1)}{' '}
                {i + 1}
              </legend>

              <label>
                {block.type === 'image'
                  ? 'Image description (alt text)'
                  : block.type === 'link'
                    ? 'Link label'
                    : 'Text'}
                <textarea
                  ref={(node) => {
                    textareas.current[i] = node;
                  }}
                  className="input"
                  value={block.text}
                  rows={block.type === 'image' || block.type === 'link' ? 2 : 5}
                  maxLength={20000}
                  onChange={(e) => update(i, { text: e.target.value })}
                />
              </label>
              {block.type === 'link' && (
                <label>
                  Link URL
                  <input
                    className="input"
                    type="url"
                    value={block.url ?? ''}
                    placeholder="https://"
                    onChange={(e) => update(i, { url: e.target.value })}
                  />
                </label>
              )}
              {block.type === 'image' && (
                <label>
                  Uploaded image
                  <select
                    className="input"
                    value={block.assetId ?? ''}
                    onChange={(e) => update(i, { assetId: e.target.value })}
                  >
                    <option value="">Choose image</option>
                    {assets
                      .filter((a) => a.content_type.startsWith('image/'))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.file_name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <div className="knowledge-actions">
                {!['image', 'link', 'code'].includes(block.type) && (
                  <>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => format(i, '**')}
                    >
                      Bold
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => format(i, '*')}
                    >
                      Italic
                    </button>
                  </>
                )}
              </div>
              <details className="knowledge-block-options">
                <summary>
                  Section options<span className="sr-only">: section {i + 1}</span>
                </summary>
                <label>
                  Section format
                  <select
                    className="input"
                    value={block.type}
                    onChange={(e) => update(i, { type: e.target.value as ArticleBlock['type'] })}
                  >
                    {blockTypes
                      .filter((type) => !library || type !== 'image')
                      .map((type) => (
                        <option key={type} value={type}>
                          {type[0].toUpperCase() + type.slice(1)}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="knowledge-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={i === 0}
                    aria-label={`Move block ${i + 1} up`}
                    onClick={() => {
                      setDirty(true);
                      focusParagraph.current = i - 1;
                      setBlocks((items) => {
                        const next = [...items];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        return next;
                      });
                    }}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={i === blocks.length - 1}
                    aria-label={`Move block ${i + 1} down`}
                    onClick={() => {
                      setDirty(true);
                      focusParagraph.current = i + 1;
                      setBlocks((items) => {
                        const next = [...items];
                        [next[i + 1], next[i]] = [next[i], next[i + 1]];
                        return next;
                      });
                    }}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    aria-label={`Remove block ${i + 1}`}
                    onClick={() => {
                      if (block.text && !window.confirm('Remove this section and its content?'))
                        return;
                      setDirty(true);
                      focusParagraph.current = Math.max(0, i - 1);
                      setBlocks((items) => items.filter((_, index) => index !== i));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </details>
            </fieldset>
          ))}
          <button
            type="button"
            className="button button-secondary"
            disabled={blocks.length >= 100}
            onClick={() => {
              setDirty(true);
              focusParagraph.current = blocks.length;
              setBlocks((items) => [...items, { type: 'paragraph', text: '' }]);
            }}
          >
            Add paragraph
          </button>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Publish settings</legend>
          <label>
            Category
            <select className="input" name="category" defaultValue={article.category}>
              {knowledgeCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Short summary (optional)
            <textarea
              className="input"
              name="summary"
              defaultValue={article.summary}
              maxLength={500}
            />
          </label>
          <label>
            Publication status
            <select className="input" name="status" defaultValue={article.status}>
              <option value="draft">Draft — IT staff only</option>
              <option value="published">Published</option>
              <option value="archived">Archived — IT staff only</option>
            </select>
          </label>
          <label>
            Audience
            <select
              className="input"
              name="audience"
              required
              value={audience}
              onChange={(event) => setAudience(event.target.value as KnowledgeAudience)}
              aria-describedby="article-audience-hint"
            >
              {Object.entries(knowledgeAudiences).map(([value, item]) => (
                <option key={value} value={value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p id="article-audience-hint" className="muted">
            {library
              ? 'Published employee-facing articles are available to active members in every workspace. Published IT only articles are available to technicians and administrators. Drafts and archived library articles are visible only to the platform owner.'
              : 'Employee-facing articles are available to employees only after publication. IT only articles stay private to technicians and administrators. Drafts and archived articles are always IT only.'}
          </p>
        </fieldset>
        <details className="progressive-section knowledge-related-disclosure">
          <summary>
            Related articles <span className="muted">Optional</span>
          </summary>
          <fieldset disabled={busy}>
            <legend className="sr-only">Related articles</legend>
            <p className="muted">
              Choose up to eight. Readers only see articles they have access to.
            </p>
            <div className="knowledge-related-options">
              {related.map((a) => (
                <label key={a.id}>
                  <input
                    type="checkbox"
                    name="related"
                    value={a.id}
                    defaultChecked={article.related_article_ids.includes(a.id)}
                  />
                  {a.title}
                  {a.audience ? ` · ${knowledgeAudiences[a.audience].label}` : ''}
                </label>
              ))}
            </div>
          </fieldset>
        </details>
        <div className="knowledge-actions">
          <button className="button button-primary" disabled={busy || uploading}>
            {busy ? 'Saving…' : isNew ? 'Create article' : 'Save article'}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              if (!dirty || confirmDiscardChanges())
                router.push(
                  library ? '/platform/library' : isNew ? '/app/help' : `/app/help/${article.id}`,
                );
            }}
          >
            Cancel
          </button>
        </div>
      </form>
      {!library && (
        <section className="settings-card">
          <h2>Images and attachments</h2>
          {isNew ? (
            <p>
              Save your article to add images and attachments. You’ll return to this editor after
              saving.
            </p>
          ) : (
            <>
              <p>Files added here are available to anyone who can read this article.</p>
              <label className="knowledge-file">
                Upload a file (up to 6 MB)
                <input
                  type="file"
                  accept={assetTypes.join(',')}
                  disabled={uploading || busy}
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {uploadMessage && <p role="status">{uploadMessage}</p>}
              <ul>
                {assets.map((a) => (
                  <li key={a.id}>
                    <a href={`/app/help/assets/${a.id}?download=1`}>{a.file_name}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <details className="settings-card progressive-section">
        <summary>Content preview</summary>
        <ArticleContent content={blocks} images={images} />
      </details>
    </div>
  );
}
