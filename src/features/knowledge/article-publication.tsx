import type { Dispatch, SetStateAction } from 'react';

import { NativeSelect, Textarea } from '@/components/ui/input';
import { helpTopics } from '@/features/knowledge/help-collections';
import type { KnowledgeArticle } from '@/types/database';

import { knowledgeAudiences, type KnowledgeAudience } from './audience';
import { knowledgeCategories } from './content';

export type ArticleMetadata = {
  title: string;
  category: KnowledgeArticle['category'];
  summary: string;
  status: KnowledgeArticle['status'];
  helpTopic: NonNullable<KnowledgeArticle['help_topic']>;
  helpFormat: NonNullable<KnowledgeArticle['help_format']>;
};
type PublicationOptions = {
  busy: boolean;
  library: boolean;
  collection: 'knowledge' | 'fixxflow';
  metadata: ArticleMetadata;
  audience: KnowledgeAudience;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setCollection: Dispatch<SetStateAction<'knowledge' | 'fixxflow'>>;
  setMetadata: Dispatch<SetStateAction<ArticleMetadata>>;
  setAudience: Dispatch<SetStateAction<KnowledgeAudience>>;
};
export function renderArticlePublication({
  busy,
  library,
  collection,
  metadata,
  audience,
  setDirty,
  setCollection,
  setMetadata,
  setAudience,
}: PublicationOptions) {
  return (
    <fieldset disabled={busy}>
      <legend>Publish settings</legend>
      {library && (
        <>
          <label>
            Help collection
            <NativeSelect
              name="helpCollection"
              value={collection}
              onChange={(event) => {
                setDirty(true);
                setCollection(event.target.value as 'knowledge' | 'fixxflow');
              }}
            >
              <option value="knowledge">Knowledge base · IT troubleshooting</option>
              <option value="fixxflow">FixxFlow Help &amp; FAQ</option>
            </NativeSelect>
          </label>
          {collection === 'fixxflow' && (
            <>
              <label>
                FixxFlow topic
                <NativeSelect
                  name="helpTopic"
                  value={metadata.helpTopic}
                  onChange={(event) =>
                    setMetadata({
                      ...metadata,
                      helpTopic: event.target.value as typeof metadata.helpTopic,
                    })
                  }
                >
                  {Object.entries(helpTopics).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label>
                Content format
                <NativeSelect
                  name="helpFormat"
                  value={metadata.helpFormat}
                  onChange={(event) =>
                    setMetadata({
                      ...metadata,
                      helpFormat: event.target.value as typeof metadata.helpFormat,
                    })
                  }
                >
                  <option value="guide">Full guide</option>
                  <option value="faq">FAQ · quick answer</option>
                </NativeSelect>
              </label>
            </>
          )}
        </>
      )}
      <label>
        Category
        <NativeSelect
          name="category"
          value={metadata.category}
          onChange={(event) =>
            setMetadata({
              ...metadata,
              category: event.target.value as typeof metadata.category,
            })
          }
        >
          {knowledgeCategories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </NativeSelect>
      </label>
      <label>
        Short summary (optional)
        <Textarea
          name="summary"
          value={metadata.summary}
          onChange={(event) => setMetadata({ ...metadata, summary: event.target.value })}
          maxLength={500}
        />
      </label>
      <label>
        Publication status
        <NativeSelect
          name="status"
          value={metadata.status}
          onChange={(event) =>
            setMetadata({ ...metadata, status: event.target.value as typeof metadata.status })
          }
        >
          <option value="draft">Draft — IT staff only</option>
          <option value="published">Published</option>
          <option value="archived">Archived — IT staff only</option>
        </NativeSelect>
      </label>
      <label>
        Audience
        <NativeSelect
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
        </NativeSelect>
      </label>
      <p id="article-audience-hint" className="muted">
        {library
          ? 'Published employee-facing articles are available to active members in every workspace. Published IT only articles are available to technicians and administrators. Drafts and archived library articles are visible only to the platform owner.'
          : 'Employee-facing articles are available to employees only after publication. IT only articles stay private to technicians and administrators. Drafts and archived articles are always IT only.'}
      </p>
    </fieldset>
  );
}
