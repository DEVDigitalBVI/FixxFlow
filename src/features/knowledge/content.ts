export const knowledgeCategories = ["Accounts", "Email", "Network", "Hardware", "Software", "Security"] as const;
export const knowledgeCategoryDescriptions: Record<typeof knowledgeCategories[number], string> = {
  Accounts: "Get help, follow requests, and manage sign-in access.",
  Email: "Sending, receiving, and finding work messages.",
  Network: "Wi-Fi, internet connections, and remote access.",
  Hardware: "Printers, displays, and workplace equipment.",
  Software: "Browsers, applications, and software access.",
  Security: "Authenticators, suspicious messages, and lost devices.",
};
export const blockTypes = ["paragraph", "heading", "list", "quote", "code", "link", "image"] as const;
export type ArticleBlock = { type: typeof blockTypes[number]; text: string; url?: string; assetId?: string };
export const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function safeArticleLink(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function parseArticleContent(value: unknown): ArticleBlock[] | null {
  if (!Array.isArray(value) || value.length > 100 || JSON.stringify(value).length > 100000) return null;
  const result: ArticleBlock[] = [];
  for (const block of value) {
    if (!block || !blockTypes.includes(block.type) || typeof block.text !== "string") return null;
    if (block.type === "link" && (typeof block.url !== "string" || !safeArticleLink(block.url))) return null;
    if (block.type === "image" && (typeof block.assetId !== "string" || !validId(block.assetId) || !block.text.trim())) return null;
    result.push({ type: block.type, text: block.text, ...(block.type === "link" ? { url: safeArticleLink(block.url)! } : {}), ...(block.type === "image" ? { assetId: block.assetId } : {}) });
  }
  return result;
}
