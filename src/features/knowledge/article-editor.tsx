"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveArticle } from "@/app/app/help/actions";
import { ArticleContent } from "./article-content";
import { blockTypes, knowledgeCategories, parseArticleContent, type ArticleBlock } from "./content";
import type { KnowledgeArticle, KnowledgeAsset } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

const assetTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
export function ArticleEditor({ article, organizationId, assets: initialAssets, related, isNew = false }: {
  article: KnowledgeArticle; organizationId: string; assets: KnowledgeAsset[]; related: { id: string; title: string }[]; isNew?: boolean;
}) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<ArticleBlock[]>(parseArticleContent(article.content) ?? []);
  const [assets, setAssets] = useState(initialAssets);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState(""); const [dirty, setDirty] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const textareas = useRef<(HTMLTextAreaElement | null)[]>([]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const update = (index: number, patch: Partial<ArticleBlock>) => { setDirty(true); setBlocks(items => items.map((item, i) => i === index ? { ...item, ...patch } : item)); };
  const format = (index: number, marker: string) => {
    const area = textareas.current[index]; if (!area) return;
    const start = area.selectionStart, end = area.selectionEnd, text = blocks[index].text;
    update(index, { text: text.slice(0, start) + marker + (text.slice(start, end) || "text") + marker + text.slice(end) });
    area.focus();
  };
  async function submit(form: FormData) {
    setBusy(true); setError("");
    form.set("content", JSON.stringify(blocks));
    try {
      const result = await saveArticle(form);
      if (result.error || !result.id) { setError(result.error ?? "Could not save."); requestAnimationFrame(() => errorRef.current?.focus()); }
      else { setDirty(false); router.push(`/app/help/${result.id}${isNew ? "/edit" : ""}`); router.refresh(); }
    } catch { setError("Could not save. Your work is still here; please retry."); }
    finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!assetTypes.includes(file.type) || file.size === 0 || file.size > 6 * 1024 * 1024) { setUploadMessage("Use a JPG, PNG, WebP, PDF, text, Word, or Excel file up to 6 MB."); return; }
    setUploading(true); setUploadMessage("");
    const database = createClient(); const id = crypto.randomUUID();
    const storagePath = `${organizationId}/${article.id}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100)}`;
    try {
      const uploaded = await database.storage.from("knowledge-assets").upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploaded.error) throw new Error();
      const saved = await database.from("knowledge_attachments").insert({ id, organization_id: organizationId, article_id: article.id, storage_path: storagePath, file_name: file.name.slice(0,255), content_type: file.type, size_bytes: file.size }).select("*").single();
      if (saved.error || !saved.data) { await database.storage.from("knowledge-assets").remove([storagePath]); throw new Error(); }
      setAssets(items => [...items, saved.data]); setUploadMessage("File added. Images are now available in image blocks.");
    } catch { setUploadMessage("Upload failed. Please select the file again to retry."); }
    finally { setUploading(false); }
  }
  const images = Object.fromEntries(assets.filter(a => a.content_type.startsWith("image/")).map(a => [a.id, `/app/help/assets/${a.id}`]));
  return <div className="knowledge-editor">
    <form action={submit} onChange={() => setDirty(true)}>
      <input type="hidden" name="id" value={article.id}/><input type="hidden" name="revision" value={article.revision}/><input type="hidden" name="new" value={String(isNew)}/>
      {error && <p ref={errorRef} tabIndex={-1} className="alert alert-error" role="alert">{error}</p>}
      <fieldset disabled={busy}><legend>Article details</legend>
        <label>Title<input className="input" name="title" defaultValue={article.title} required minLength={3} maxLength={180}/></label>
        <label>Category<select className="input" name="category" defaultValue={article.category}>{knowledgeCategories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Summary<textarea className="input" name="summary" defaultValue={article.summary} maxLength={500}/></label>
        <label>Visibility<select className="input" name="status" defaultValue={article.status}><option value="draft">Draft — IT staff only</option><option value="published">Published — all organization members</option><option value="archived">Archived — IT staff only</option></select></label>
      </fieldset>
      <fieldset disabled={busy}><legend>Article content</legend><p className="muted">Add content blocks. Bold uses **text** and italic uses *text*. List items go on separate lines.</p>
        {blocks.map((block, i) => <fieldset className="knowledge-block" key={i}><legend>Block {i + 1}</legend>
          <label>Content type<select className="input" value={block.type} onChange={e => update(i, { type: e.target.value as ArticleBlock["type"] })}>{blockTypes.map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label>
          <label>{block.type === "image" ? "Image description (alt text)" : block.type === "link" ? "Link label" : "Text"}<textarea ref={node => { textareas.current[i] = node; }} className="input" value={block.text} rows={block.type === "image" || block.type === "link" ? 2 : 5} maxLength={20000} onChange={e => update(i, { text: e.target.value })}/></label>
          {block.type === "link" && <label>Link URL<input className="input" type="url" value={block.url ?? ""} placeholder="https://" onChange={e => update(i, { url: e.target.value })}/></label>}
          {block.type === "image" && <label>Uploaded image<select className="input" value={block.assetId ?? ""} onChange={e => update(i, { assetId: e.target.value })}><option value="">Choose image</option>{assets.filter(a => a.content_type.startsWith("image/")).map(a => <option key={a.id} value={a.id}>{a.file_name}</option>)}</select></label>}
          <div className="knowledge-actions">{!["image","link","code"].includes(block.type) && <><button type="button" className="button button-secondary" onClick={() => format(i,"**")}>Bold</button><button type="button" className="button button-secondary" onClick={() => format(i,"*")}>Italic</button></>}
            <button type="button" className="button button-secondary" disabled={i === 0} aria-label={`Move block ${i + 1} up`} onClick={() => { setDirty(true); setBlocks(items => { const next = [...items]; [next[i-1], next[i]] = [next[i], next[i-1]]; return next; }); }}>Move up</button>
            <button type="button" className="button button-secondary" disabled={i === blocks.length - 1} aria-label={`Move block ${i + 1} down`} onClick={() => { setDirty(true); setBlocks(items => { const next = [...items]; [next[i+1], next[i]] = [next[i], next[i+1]]; return next; }); }}>Move down</button>
            <button type="button" className="button button-secondary" aria-label={`Remove block ${i + 1}`} onClick={() => { setDirty(true); setBlocks(items => items.filter((_, index) => index !== i)); }}>Remove</button>
          </div></fieldset>)}
        <button type="button" className="button button-secondary" disabled={blocks.length >= 100} onClick={() => { setDirty(true); setBlocks(items => [...items, { type: "paragraph", text: "" }]); }}>Add content block</button>
      </fieldset>
      <fieldset disabled={busy}><legend>Related articles</legend><p className="muted">Choose up to eight. Readers only see articles they have access to.</p><div className="knowledge-related-options">{related.map(a => <label key={a.id}><input type="checkbox" name="related" value={a.id} defaultChecked={article.related_article_ids.includes(a.id)}/>{a.title}</label>)}</div></fieldset>
      <div className="knowledge-actions"><button className="button button-primary" disabled={busy || uploading}>{busy ? "Saving…" : isNew ? "Create article" : "Save article"}</button><button type="button" className="button button-secondary" onClick={() => { if (!dirty || window.confirm("Discard unsaved article changes?")) router.push(isNew ? "/app/help" : `/app/help/${article.id}`); }}>Cancel</button></div>
    </form>
    <section className="settings-card"><h2>Images and attachments</h2>{isNew ? <p>Create the article first, then upload files.</p> : <><p>Files added here are available to anyone who can read this article.</p><label className="knowledge-file">Upload a file (up to 6 MB)<input type="file" accept={assetTypes.join(",")} disabled={uploading || busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value=""; }}/></label>{uploadMessage && <p role="status">{uploadMessage}</p>}<ul>{assets.map(a => <li key={a.id}><a href={`/app/help/assets/${a.id}?download=1`}>{a.file_name}</a></li>)}</ul></>}</section>
    <section className="settings-card"><h2>Content preview</h2><ArticleContent content={blocks} images={images}/></section>
  </div>;
}
