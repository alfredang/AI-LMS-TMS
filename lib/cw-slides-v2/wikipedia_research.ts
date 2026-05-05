/**
 * Environment-agnostic research using Wikipedia as primary source.
 *
 * This path bypasses Claude synthesis entirely for the source-list portion:
 * Wikipedia REST API → deterministic ResearchEntry with real sources.
 *
 * Why this exists:
 * - Localhost has subscription token + clean network → SDK WebSearch works,
 *   Claude synthesis succeeds, deck has 54+ unique real sources.
 * - Production has API key without WebSearch + restricted egress → SDK
 *   WebSearch fails, DDG sometimes blocked, Claude synthesis errors out,
 *   deck falls to deepest fallback with 3 generic sources repeating.
 *
 * Wikipedia REST API works in both environments:
 * - Public, no API key needed
 * - Stable IPs, not blocked from data-center regions
 * - Generous rate limits
 * - Returns rich content (titles, URLs, summaries)
 *
 * Strategy: per topic, run 2-3 Wikipedia searches with different query
 * angles, dedupe results, take top 5 as sources. Pull article summaries
 * for the top 3 to populate `summary` field. NO Claude call required for
 * sources — they're real Wikipedia article titles. Claude synthesis is
 * still used (best-effort) to enrich `infographic_data` (chart_data,
 * process_steps, etc.) but if it fails, we have real sources to fall
 * back on instead of generic NIST/OECD pool.
 */

import type { ResearchEntry, ResearchSource } from './types';

const WIKIPEDIA_BASE = 'https://en.wikipedia.org/w/rest.php/v1';
const SUMMARY_BASE = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const UA = 'cw-slides-v2/1.0 (+https://github.com/alfredang/AI-LMS-TMS)';

interface WikiSearchResult {
  title: string;
  description?: string;
  excerpt?: string;
  key?: string; // URL-safe page key
}

interface WikiSummary {
  title: string;
  extract?: string; // first paragraph in plain text
  description?: string;
  content_urls?: { desktop?: { page?: string } };
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function wikiSearch(query: string, limit = 6): Promise<WikiSearchResult[]> {
  const url = `${WIKIPEDIA_BASE}/search/page?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 10)}`;
  try {
    const r = await fetchWithTimeout(url, 6000);
    if (!r.ok) return [];
    const json = await r.json() as { pages?: WikiSearchResult[] };
    return Array.isArray(json.pages) ? json.pages : [];
  } catch (e: any) {
    console.warn(`[wikipedia_research] search failed for "${query.slice(0, 40)}":`, e?.message);
    return [];
  }
}

async function wikiSummary(pageKey: string): Promise<WikiSummary | null> {
  if (!pageKey) return null;
  const url = `${SUMMARY_BASE}/${encodeURIComponent(pageKey)}`;
  try {
    const r = await fetchWithTimeout(url, 6000);
    if (!r.ok) return null;
    return (await r.json()) as WikiSummary;
  } catch (e: any) {
    return null;
  }
}

/**
 * Run 2-3 Wikipedia searches with different angles for the topic, dedupe,
 * fetch summaries for the top 3 articles, return a ResearchEntry with real
 * sources. Always returns SOMETHING valid — even if Wikipedia returns 0
 * results for one query, the others usually find pages.
 *
 * Articles are RELEVANCE-FILTERED before being adopted as sources.
 * Wikipedia search will happily return "3D printing" for a query about
 * "Responsible AI" because both share words like "AI" or "applications".
 * Without filtering those off-topic articles flow through to the final
 * infographic and produce nonsense ("3D printing, also called …" on a
 * Responsible-AI slide). The filter requires meaningful keyword overlap
 * between the article title/excerpt and the topic title.
 */
function topicKeywords(text: string): Set<string> {
  const STOP = new Set(['the','a','an','of','in','on','to','for','and','or','with','by','is','are','was','were','be','been','this','that','these','those','it','they','we','you','its','their','his','her','our','your','as','at','from','about','into','onto','via','per','use','using','used','apply','applies','identify','introduce','overview','basics','fundamentals','principles','techniques','strategies','methods','data','content','information','application','applications','tools','platforms','including','such','etc','eg','ie']);
  return new Set(
    text.toLowerCase()
      .replace(/[.,;:!?()'"\[\]\/]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
  );
}
function relevanceScore(article: WikiSearchResult, topicKws: Set<string>): number {
  const blob = `${article.title || ''} ${article.description || ''} ${article.excerpt || ''}`;
  const articleKws = topicKeywords(blob);
  let overlap = 0;
  for (const k of articleKws) if (topicKws.has(k)) overlap++;
  // Articles whose title contains a topic keyword get a small boost.
  const titleLower = (article.title || '').toLowerCase();
  let titleBoost = 0;
  for (const k of topicKws) if (titleLower.includes(k)) { titleBoost += 1; break; }
  return overlap + titleBoost;
}

export async function wikipediaResearch(topicTitle: string, courseTitle: string): Promise<ResearchEntry> {
  const cleanTopic = topicTitle.replace(/[\(\[].*?[\)\]]/g, '').trim();
  // Anchor every query with the course context so generic words like "AI"
  // or "data" don't pull in unrelated articles (3D printing, smart cities)
  // when the course is specifically about "Responsible Generative AI".
  const queries = [
    `${cleanTopic} ${courseTitle}`.slice(0, 120),
    cleanTopic,
    `${cleanTopic} framework standards best practices`,
  ].filter((q, i, arr) => arr.indexOf(q) === i);

  const searchResults = await Promise.all(queries.map((q) => wikiSearch(q, 8)));

  // Flatten + dedupe by title
  const seen = new Set<string>();
  const allPages: WikiSearchResult[] = [];
  for (const batch of searchResults) {
    for (const p of batch) {
      const key = (p.title || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      allPages.push(p);
    }
  }

  // Score every article against topic+course keywords; reject low-relevance
  const topicKws = topicKeywords(`${cleanTopic} ${courseTitle}`);
  const scored = allPages
    .map((p) => ({ page: p, score: relevanceScore(p, topicKws) }))
    .sort((a, b) => b.score - a.score);
  // Require at least 1 keyword overlap; if too aggressive (no articles pass),
  // fall back to top 5 unfiltered to ensure we always return SOMETHING.
  const filtered = scored.filter((s) => s.score >= 1).map((s) => s.page);
  const finalPages = filtered.length >= 2 ? filtered : scored.slice(0, 5).map((s) => s.page);
  const topPages = finalPages.slice(0, 5);
  const summaryPromises = topPages.slice(0, 3).map((p) => p.key ? wikiSummary(p.key) : Promise.resolve(null));
  const summaries = await Promise.all(summaryPromises);

  // Decode common HTML entities and strip noise that Wikipedia injects
  // into article text (citation markers, retrieval dates, see-also
  // footers). Without this cleanup, items show up as &quot;Voxtral
  // and "Retrieved 7 December 2025" in the rendered infographics.
  const HTML_ENTITIES: Record<string, string> = {
    '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&apos;': "'", '&#39;': "'", '&nbsp;': ' ',
  };
  const decodeEntities = (s: string): string => {
    return s.replace(/&[a-z#0-9]+;/gi, (m) => {
      if (HTML_ENTITIES[m]) return HTML_ENTITIES[m];
      const num = m.match(/^&#(\d+);$/);
      if (num) return String.fromCharCode(Number(num[1]));
      return m;
    });
  };

  // Wikipedia "junk" patterns to filter out — citation/footnote text
  // that's not real content.
  const JUNK_PATTERNS = [
    /^retrieved\b/i,
    /^archived\b/i,
    /^\[(citation needed|edit|note|\d+)\]/i,
    /^\d+ [a-z]+ \d{4}\.?$/i,                  // "7 December 2025"
    /^see also\b/i, /^references?$/i, /^external links\b/i,
    /^further reading\b/i, /^bibliography\b/i,
    /^\^/, /^[a-z]\.\s*$/i,                     // footnote markers like "^a"
  ];
  const isJunk = (s: string): boolean => {
    const trimmed = s.trim();
    if (trimmed.length < 20) return true;
    if (JUNK_PATTERNS.some((re) => re.test(trimmed))) return true;
    // Sentences that are mostly numbers / punctuation
    const wordCount = (trimmed.match(/[a-zA-Z]{3,}/g) || []).length;
    if (wordCount < 3) return true;
    return false;
  };

  // Build ResearchEntry — split each Wikipedia summary into multiple
  // clean bullet-sized findings.
  const splitToFindings = (text: string): string[] => {
    if (!text) return [];
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => decodeEntities(s.replace(/<[^>]+>/g, '').replace(/\[\d+\]/g, '')).trim())
      .filter((s) => s.length >= 25 && s.length <= 180 && !isJunk(s));
  };

  const sources: ResearchSource[] = topPages.map((p, i) => {
    const summary = summaries[i];
    const url = summary?.content_urls?.desktop?.page
      || (p.key ? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}` : '');
    const excerpt = decodeEntities((p.excerpt || p.description || '').replace(/<[^>]+>/g, '').replace(/\[\d+\]/g, '').trim());
    const extract = summary?.extract || '';
    // Each finding = ONE substantive sentence. Up to 6 per source.
    const findings = [
      ...splitToFindings(excerpt),
      ...splitToFindings(extract),
    ].slice(0, 6);
    return {
      title: decodeEntities(p.title || ''),
      url,
      type: 'wikipedia',
      key_findings: findings.length > 0 ? findings : (excerpt && !isJunk(excerpt) ? [excerpt.slice(0, 160)] : []),
      relevance_score: 1.0 - (i * 0.1),
      date: new Date().getFullYear().toString(),
    };
  });

  // Build summary from top 2-3 article extracts
  const summaryParts: string[] = [];
  for (const s of summaries) {
    if (s?.extract) summaryParts.push(s.extract.slice(0, 400));
  }
  const summary = summaryParts.join('\n\n').slice(0, 1200);

  // Pull MANY bullet-point-style sentences from extracts. Padding picks
  // 4-5 of these per process/list block, so we want 15-20 available.
  const allText = summaryParts.join(' ');
  const sentences = allText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 200)
    .slice(0, 20);

  console.log(`[wikipedia_research] '${topicTitle.slice(0, 60)}': ${sources.length} sources, ${summaryParts.length} summaries fetched`);

  return {
    topic: topicTitle,
    sources,
    summary,
    search_queries_used: queries,
    key_statistics: [],
    recommended_frameworks: [],
    infographic_data: {
      chart_data: [],
      process_steps: sentences,
      comparison_items: [],
      hierarchy_data: {},
      timeline_data: [],
    },
  };
}
