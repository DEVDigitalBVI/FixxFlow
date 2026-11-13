import type { Dispatch, RefObject, SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import type { KnowledgeAsset } from '@/types/database';

import { blockTypes, type ArticleBlock } from './content';

type BlocksEditorOptions = {
  busy: boolean;
  blocks: ArticleBlock[];
  assets: KnowledgeAsset[];
  library: boolean;
  format: (index: number, marker: string) => void;
  update: (index: number, patch: Partial<ArticleBlock>) => void;
  textareasRef: RefObject<(HTMLTextAreaElement | null)[]>;
  focusParagraphRef: RefObject<number | null>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setBlocks: Dispatch<SetStateAction<ArticleBlock[]>>;
};
/** Presentation and section controls; draft ownership remains in ArticleEditor. */
export function renderArticleBlocksEditor({
  busy,
  blocks,
  assets,
  library,
  format,
  update,
  textareasRef,
  focusParagraphRef,
  setDirty,
  setBlocks,
}: BlocksEditorOptions) {
  return (
    <fieldset disabled={busy}>
      <legend>Write your article</legend>
      <p className="muted">
        Start with the answer, then explain the steps. Use Bold and Italic to format selected text.
      </p>
      {blocks.map((block, i) => (
        <fieldset className="knowledge-block" key={i}>
          <legend>
            {block.type === 'paragraph'
              ? 'Paragraph'
              : block.type[0].toUpperCase() + block.type.slice(1)}{' '}
            {i + 1}
          </legend>

          <div className="knowledge-actions" role="group" aria-label={`Format section ${i + 1}`}>
            {!['image', 'link', 'code'].includes(block.type) && (
              <>
                <Button type="button" variant="secondary" onClick={() => format(i, '**')}>
                  Bold
                </Button>
                <Button type="button" variant="secondary" onClick={() => format(i, '*')}>
                  Italic
                </Button>
              </>
            )}
          </div>
          <label>
            {block.type === 'image'
              ? 'Image description (alt text)'
              : block.type === 'link'
                ? 'Link label'
                : 'Text'}
            <Textarea
              ref={(node) => {
                textareasRef.current[i] = node;
              }}
              value={block.text}
              rows={block.type === 'image' || block.type === 'link' ? 2 : 5}
              maxLength={20000}
              onChange={(e) => update(i, { text: e.target.value })}
            />
          </label>
          {block.type === 'link' && (
            <label>
              Link URL
              <Input
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
              <NativeSelect
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
              </NativeSelect>
            </label>
          )}
          <details className="knowledge-block-options">
            <summary>
              Section options<span className="sr-only">: section {i + 1}</span>
            </summary>
            <label>
              Section format
              <NativeSelect
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
              </NativeSelect>
            </label>
            <div className="knowledge-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={i === 0}
                aria-label={`Move block ${i + 1} up`}
                onClick={() => {
                  setDirty(true);
                  focusParagraphRef.current = i - 1;
                  setBlocks((items) => {
                    const next = [...items];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    return next;
                  });
                }}
              >
                Move up
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={i === blocks.length - 1}
                aria-label={`Move block ${i + 1} down`}
                onClick={() => {
                  setDirty(true);
                  focusParagraphRef.current = i + 1;
                  setBlocks((items) => {
                    const next = [...items];
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    return next;
                  });
                }}
              >
                Move down
              </Button>
              <Button
                type="button"
                variant="secondary"
                aria-label={`Remove block ${i + 1}`}
                onClick={() => {
                  if (block.text && !window.confirm('Remove this section and its content?')) return;
                  setDirty(true);
                  focusParagraphRef.current = Math.max(0, i - 1);
                  setBlocks((items) => items.filter((_, index) => index !== i));
                }}
              >
                Remove
              </Button>
            </div>
          </details>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={blocks.length >= 100}
        onClick={() => {
          setDirty(true);
          focusParagraphRef.current = blocks.length;
          setBlocks((items) => [...items, { type: 'paragraph', text: '' }]);
        }}
      >
        Add paragraph
      </Button>
    </fieldset>
  );
}
