'use server';

import { revalidatePath } from 'next/cache';

import { isKnowledgeAudience } from '@/features/knowledge/audience';
import { knowledgeCategories, parseArticleContent, validId } from '@/features/knowledge/content';
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
  return { id };
}
