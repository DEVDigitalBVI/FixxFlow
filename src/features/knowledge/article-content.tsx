/* Private authenticated images intentionally bypass the public image optimizer. */
/* eslint-disable @next/next/no-img-element */
import { Fragment, type ReactNode } from 'react';

import { parseArticleContent, safeArticleLink } from './content';

function inline(text: string): ReactNode {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith('*') && part.endsWith('*') ? (
        <em key={i}>{part.slice(1, -1)}</em>
      ) : (
        part
      ),
    );
}
export function ArticleContent({
  content,
  images = {},
  showContents = false,
  stepScreenshots = [],
}: {
  content: unknown;
  images?: Record<string, string>;
  showContents?: boolean;
  stepScreenshots?: {
    afterText: string;
    src: string;
    alt: string;
    source: string;
    width: number;
    height: number;
  }[];
}) {
  const blocks = parseArticleContent(content);
  if (!blocks)
    return <p role="alert">This article’s content could not be displayed. Please contact IT.</p>;
  const headings = blocks.flatMap((block, index) =>
    block.type === 'heading' ? [{ text: block.text, index }] : [],
  );
  return (
    <div className="knowledge-content">
      {showContents && headings.length > 1 && (
        <nav className="knowledge-contents" aria-label="On this page">
          <strong>On this page</strong>
          <ul>
            {headings.map((heading) => (
              <li key={heading.index}>
                <a href={`#article-section-${heading.index}`}>{inline(heading.text)}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return (
              <h2
                key={i}
                id={showContents ? `article-section-${i}` : undefined}
                tabIndex={showContents ? -1 : undefined}
              >
                {inline(block.text)}
              </h2>
            );
          case 'list':
            return (
              <ul key={i}>
                {block.text
                  .split('\n')
                  .filter(Boolean)
                  .map((line, j) => (
                    <li key={j}>{inline(line)}</li>
                  ))}
              </ul>
            );
          case 'quote':
            return <blockquote key={i}>{inline(block.text)}</blockquote>;
          case 'code':
            return (
              <pre key={i}>
                <code>{block.text}</code>
              </pre>
            );
          case 'link':
            return (
              <p key={i}>
                <a
                  href={safeArticleLink(block.url ?? '') ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${block.text} (opens in a new tab)`}
                >
                  {block.text}
                </a>
              </p>
            );
          case 'image':
            return images[block.assetId ?? ''] ? (
              <figure key={i}>
                <img src={images[block.assetId!]} alt={block.text} />
              </figure>
            ) : (
              <p key={i}>Image unavailable: {block.text}</p>
            );
          default:
            return (
              <Fragment key={i}>
                <p>{inline(block.text)}</p>
                {stepScreenshots
                  .filter((shot) => shot.afterText === block.text)
                  .map((shot) => (
                    <figure key={shot.src} className="knowledge-step-screenshot">
                      <a
                        href={shot.src}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open full-size screenshot: ${shot.alt} (opens in a new tab)`}
                      >
                        <img
                          src={shot.src}
                          alt={shot.alt}
                          width={shot.width}
                          height={shot.height}
                          loading="lazy"
                          decoding="async"
                        />
                      </a>
                      <figcaption>
                        {shot.alt}{' '}
                        <a
                          href={shot.src}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open full-size screenshot: ${shot.alt} (opens in a new tab)`}
                        >
                          Open full-size screenshot
                        </a>
                        {' · '}
                        <a
                          href={shot.source}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Microsoft source (opens in a new tab)"
                        >
                          Microsoft source
                        </a>
                        <span className="muted"> Screens may vary by app version and device.</span>
                      </figcaption>
                    </figure>
                  ))}
              </Fragment>
            );
        }
      })}
    </div>
  );
}
