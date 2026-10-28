import { ArticleContent } from './article-content';
import { parseArticleContent } from './content';
import { microsoftScreenshots } from './microsoft-screenshots';

/** Match reviewed steps and their references; edited or unrelated steps receive no screenshot. */
export function LibraryArticleContent({ content }: { content: unknown }) {
  const blocks = parseArticleContent(content);
  const sources = new Set(
    blocks?.filter((block) => block.type === 'link').map((block) => block.url),
  );
  return (
    <ArticleContent
      content={content}
      showContents
      stepScreenshots={microsoftScreenshots.filter((shot) => sources.has(shot.source))}
    />
  );
}
