'use server';

import { revalidatePath } from 'next/cache';

import { isKnowledgeAudience } from '@/features/knowledge/audience';
import { knowledgeCategories, parseArticleContent, validId } from '@/features/knowledge/content';
import { isHelpTopic } from '@/features/knowledge/help-collections';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { formString } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

export async function saveLibraryArticle(form: FormData): Promise<{ error?: string; id?: string }> {
  await requirePlatformOwner();
  const id = formString(form, 'id', '');
  const title = formString(form, 'title', '').trim();
  const summary = formString(form, 'summary', '').trim();
  const category = formString(form, 'category', '');
  const status = formString(form, 'status', 'draft');
  const audience = form.get('audience');
  const collection = form.get('helpCollection');
  const topic = form.get('helpTopic');
  const format = form.get('helpFormat');
  if (
    collection !== null &&
    ((collection !== 'knowledge' && collection !== 'fixxflow') ||
      (collection === 'fixxflow' &&
        (!isHelpTopic(topic) || !['guide', 'faq'].includes(String(format)))))
  )
    return { error: 'Choose a valid help collection, topic, and content format.' };
  let content;
  try {
    content = parseArticleContent(JSON.parse(formString(form, 'content', '[]')));
  } catch {
    content = null;
  }
  const related = [...new Set(form.getAll('related').map(String))];
  if (
    !validId(id) ||
    title.length < 3 ||
    title.length > 180 ||
    summary.length > 500 ||
    !knowledgeCategories.some((c) => c === category) ||
    !['draft', 'published', 'archived'].includes(status) ||
    !isKnowledgeAudience(audience) ||
    !content ||
    content.some((b) => b.type === 'image') ||
    related.length > 8 ||
    related.some((r) => !validId(r) || r === id) ||
    (status === 'published' && !content.some((b) => b.text.trim()))
  ) {
    return {
      error:
        'Check the title, category, audience, content and links. Library articles support text and links. Choose up to eight related library articles.',
    };
  }
  const values = {
    title,
    summary,
    category,
    status,
    audience,
    content,
    related_article_ids: related,
    ...(collection !== null
      ? {
          help_collection: collection as 'knowledge' | 'fixxflow',
          help_topic:
            collection === 'fixxflow'
              ? (topic as keyof typeof import('@/features/knowledge/help-collections').helpTopics)
              : null,
          help_format: collection === 'fixxflow' ? (format as 'guide' | 'faq') : ('guide' as const),
        }
      : {}),
  };
  try {
    const db = await createClient();
    const result =
      form.get('new') === 'true'
        ? await db
            .from('library_articles')
            .insert({ ...values, id })
            .select('id')
            .single()
        : await db
            .from('library_articles')
            .update(values)
            .eq('id', id)
            .eq('revision', Number(form.get('revision')))
            .select('id')
            .maybeSingle();
    if (result.error || !result.data)
      return {
        error:
          'Could not save. Another editor may have changed this article. Compare in a separate tab or retry. Your work is still here.',
      };
  } catch {
    return { error: 'Could not save. Your work is still here; please retry.' };
  }
  revalidatePath('/platform/library', 'layout');
  revalidatePath('/app/help', 'layout');
  revalidatePath('/app/faq', 'layout');
  return { id };
}
