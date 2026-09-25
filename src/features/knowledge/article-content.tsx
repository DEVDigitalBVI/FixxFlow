/* Private authenticated images intentionally bypass the public image optimizer. */
/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from "react";
import { parseArticleContent, safeArticleLink } from "./content";

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("*") && part.endsWith("*") ? <em key={i}>{part.slice(1, -1)}</em> : part);
}
export function ArticleContent({ content, images = {} }: { content: unknown; images?: Record<string, string> }) {
  const blocks = parseArticleContent(content);
  if (!blocks) return <p role="alert">This article’s content could not be displayed. Please contact IT.</p>;
  return <div className="knowledge-content">{blocks.map((block, i) => {
    switch (block.type) {
      case "heading": return <h2 key={i}>{inline(block.text)}</h2>;
      case "list": return <ul key={i}>{block.text.split("\n").filter(Boolean).map((line, j) => <li key={j}>{inline(line)}</li>)}</ul>;
      case "quote": return <blockquote key={i}>{inline(block.text)}</blockquote>;
      case "code": return <pre key={i}><code>{block.text}</code></pre>;
      case "link": return <p key={i}><a href={safeArticleLink(block.url ?? "") ?? undefined} rel="noreferrer">{block.text}</a></p>;
      case "image": return images[block.assetId ?? ""] ? <figure key={i}><img src={images[block.assetId!]} alt={block.text} /></figure> : <p key={i}>Image unavailable: {block.text}</p>;
      default: return <p key={i}>{inline(block.text)}</p>;
    }
  })}</div>;
}
