export type SuggestedArticle = { id: string; title: string; summary: string; category: string };
const stopWords = new Set('the and for with that this from have has are was were not can cant cannot please help need issue problem my our your when what how does work working'.split(' '));
function words(value: string) {
  return [...new Set(value.toLowerCase().replace(/wi[ -]?fi/g, 'wifi').replace(/[’']/g, '').split(/[^\p{L}\p{N}]+/u).map(word => word.length > 4 ? word.replace(/s$/, '') : word).filter(word => word.length >= 3 && !stopWords.has(word)))];
}
export function suggestArticles(articles: SuggestedArticle[], description: string, category: string) {
  const terms = words(description.slice(0, 1500));
  const categoryTerms = words(category);
  return articles.map(article => {
    const title = words(article.title);
    const summary = words(article.summary);
    const topics = words(article.category);
    const matches = (tokens: string[], word: string) => tokens.some(token => token === word || (word.length >= 5 && token.startsWith(word)));
    const score = terms.reduce((sum, word) => sum + (matches(title, word) ? 4 : matches(summary, word) ? 1 : 0), 0)
      + categoryTerms.reduce((sum, word) => sum + (topics.includes(word) ? 3 : title.includes(word) ? 2 : 0), 0);
    return { article, score };
  }).filter(match => match.score >= 2).sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title)).slice(0, 3).map(match => match.article);
}
