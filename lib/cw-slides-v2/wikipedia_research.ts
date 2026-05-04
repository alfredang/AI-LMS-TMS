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
 */
export async function wikipediaResearch(topicTitle: string, courseTitle: string): Promise<ResearchEntry> {
  const cleanTopic = topicTitle.replace(/[\(\[].*?[\)\]]/g, '').trim();
  const queries = [
    cleanTopic,
    `${cleanTopic} ${courseTitle}`.slice(0, 100),
    `${cleanTopic} framework standards best practices`,
  ].filter((q, i, arr) => arr.indexOf(q) === i); // dedupe

  // Run all searches in parallel
  const searchResults = await Promise.all(queries.map((q) => wikiSearch(q, 6)));

  // Flatten + dedupe by title
  const seen = new Set<string>();
  const allPages: WikiSearchResult[] = [];
  for (const batch of searchResults) {
    for (const p of batch) {
      const key = (p.title || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      allPages.push(p);
      if (allPages.length >= 8) break;
    }
    if (allPages.length >= 8) break;
  }

  // Take top 5 unique pages, fetch summaries for top 3 in parallel
  const topPages = allPages.slice(0, 5);
  const summaryPromises = topPages.slice(0, 3).map((p) => p.key ? wikiSummary(p.key) : Promise.resolve(null));
  const summaries = await Promise.all(summaryPromises);

  // Build ResearchEntry
  const sources: ResearchSource[] = topPages.map((p, i) => {
    const summary = summaries[i];
    const url = summary?.content_urls?.desktop?.page
      || (p.key ? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}` : '');
    const excerpt = (p.excerpt || p.description || '').replace(/<[^>]+>/g, '').trim();
    const findings: string[] = [];
    if (excerpt) findings.push(excerpt.slice(0, 160));
    if (summary?.extract) findings.push(summary.extract.slice(0, 200));
    return {
      title: p.title,
      url,
      type: 'wikipedia',
      key_findings: findings.filter(Boolean).slice(0, 2),
      relevance_score: 1.0 - (i * 0.1),
      date: new Date().getFullYear().toString(),
    };
  });

  // Build summary from top 2-3 article extracts
  const summaryParts: string[] = [];
  for (const s of summaries) {
    if (s?.extract) summaryParts.push(s.extract.slice(0, 300));
  }
  const summary = summaryParts.join('\n\n').slice(0, 800);

  // Pull bullet-point-style steps from longer extracts when available.
  // Heuristic: split by sentence, take 4-6 short sentences.
  const allText = summaryParts.join(' ');
  const sentences = allText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 200)
    .slice(0, 4);

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
