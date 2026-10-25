'use server';

import { revalidatePath } from 'next/cache';

import { isKnowledgeAudience } from '@/features/knowledge/audience';
import { knowledgeCategories, parseArticleContent, validId } from '@/features/knowledge/content';
import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

export async function saveArticle(form: FormData): Promise<{ error?: string; id?: string }> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can edit articles.' };
  const id = formString(form, 'id', '');
  const title = formString(form, 'title', '').trim();
  const summary = formString(form, 'summary', '').trim();
  const category = formString(form, 'category', '');
  const status = formString(form, 'status', 'draft');
  const audience = form.get('audience');
  if (!isKnowledgeAudience(audience))
    return { error: 'Choose the article audience: Employee-facing or IT only.' };
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
    !content ||
    related.length > 8 ||
    related.some((r) => !validId(r) || r === id) ||
    (status === 'published' && !content.some((b) => b.text.trim()))
  )
    return {
      error:
        'Check the title, category, content, image descriptions, and links. Choose up to eight related articles.',
    };
  const supabase = await createClient();
  const imageIds = content.filter((b) => b.type === 'image').map((b) => b.assetId!);
  if (imageIds.length) {
    const { data, error } = await supabase
      .from('knowledge_attachments')
      .select('id,content_type')
      .eq('organization_id', viewer.organizationId)
      .eq('article_id', id)
      .in('id', imageIds);
    if (
      error ||
      imageIds.some(
        (image) =>
          !data?.some((asset) => asset.id === image && asset.content_type.startsWith('image/')),
      )
    )
      return { error: 'Choose images uploaded to this article.' };
  }
  const values = {
    title,
    summary,
    category,
    content,
    audience,
    status: status as 'draft' | 'published' | 'archived',
    related_article_ids: related,
  };
  try {
    const revision = Number(form.get('revision'));
    const result =
      form.get('new') === 'true'
        ? await supabase
            .from('knowledge_articles')
            .insert({ ...values, id, organization_id: viewer.organizationId })
            .select('id')
            .single()
        : await supabase
            .from('knowledge_articles')
            .update(values)
            .eq('id', id)
            .eq('organization_id', viewer.organizationId)
            .eq('revision', revision)
            .select('id')
            .maybeSingle();
    if (result.error || !result.data)
      return {
        error:
          'Could not save. Another editor may have changed this article; reload in a separate tab to compare, or retry. Your work is still here.',
      };
  } catch {
    return { error: 'Could not save. Your work is still here; please retry.' };
  }
  revalidatePath('/app/help', 'layout');
  return { id };
}

export async function recordArticleView(articleId: string) {
  const viewer = await requireViewer();
  if (!validId(articleId)) return;
  const supabase = await createClient();
  await supabase.rpc('record_article_view', {
    target_organization_id: viewer.organizationId,
    target_article_id: articleId,
  });
}
export async function rateArticle(articleId: string, helpful: boolean) {
  const viewer = await requireViewer();
  if (!validId(articleId) || typeof helpful !== 'boolean')
    return { error: 'Choose a valid article.' };
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('rate_article', {
      target_organization_id: viewer.organizationId,
      target_article_id: articleId,
      is_helpful: helpful,
    });
    if (error) return { error: 'Your feedback could not be saved. Please retry.' };
    return { success: true };
  } catch {
    return { error: 'Your feedback could not be saved. Please retry.' };
  }
}
