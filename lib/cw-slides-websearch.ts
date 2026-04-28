/**
 * Node-side web search for the slides Research Agent.
 *
 * The Anthropic Agent SDK's WebSearch tool requires the API key to have
 * web search permissions enabled (most basic API keys and all OAuth
 * subscription tokens lack this). When the production key doesn't have
 * WebSearch, the Research Agent returns 0 sources, content generation
 * crashes, and the whole deck falls back to "Source: Course Proposal"
 * captions on every infographic.
 *
 * This module bypasses that restriction by doing the search ourselves
 * with a plain HTTP fetch against DuckDuckGo's HTML endpoint (no API
 * key needed) and parsing results with cheerio. The Research Agent
 * then receives real internet search results as plain text in the
 * prompt body and synthesises them into structured research output —
 * works on ANY Anthropic API key.
 *
 * Falls back to knowledge-based research only if the network search
 * itself fails (rare — DDG's HTML endpoint is very stable).
 */

import * as cheerio from 'cheerio';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// Try the DuckDuckGo HTML lite endpoint first — it's very minimal and
// rarely blocked. Falls back to the regular HTML endpoint if lite fails.
const DDG_ENDPOINTS = [
  'https://html.duckduckgo.com/html/',
  'https://lite.duckduckgo.com/lite/',
];

export async function searchWeb(query: string, maxResults = 5, timeoutMs = 8000): Promise<WebSearchResult[]> {
  for (const endpoint of DDG_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const params = new URLSearchParams({ q: query });
      const r = await fetch(`${endpoint}?${params.toString()}`, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const html = await r.text();
      const results = endpoint.includes('lite')
        ? parseDdgLite(html, maxResults)
        : parseDdgHtml(html, maxResults);
      if (results.length > 0) return results;
    } catch (e: any) {
      // Try next endpoint
      continue;
    }
  }
  return [];
}

function parseDdgHtml(html: string, maxResults: number): WebSearchResult[] {
  const $ = cheerio.load(html);
  const results: WebSearchResult[] = [];
  $('.result').each((_i, el) => {
    if (results.length >= maxResults) return false;
    const $el = $(el);
    const title = $el.find('.result__title').text().trim();
    let url = $el.find('.result__url').text().trim();
    if (!url) url = $el.find('.result__a').attr('href') ?? '';
    const snippet = $el.find('.result__snippet').text().trim();
    if (title && (snippet || url)) {
      results.push({ title, url, snippet });
    }
    return undefined;
  });
  return results;
}

function parseDdgLite(html: string, maxResults: number): WebSearchResult[] {
  const $ = cheerio.load(html);
  const results: WebSearchResult[] = [];
  // DDG lite uses <table> rows with .result-link / .result-snippet classes
  // OR a flat list of <a class="result-link"> followed by snippet text.
  const links = $('a.result-link, a.result__a').toArray();
  for (const linkEl of links) {
    if (results.length >= maxResults) break;
    const $link = $(linkEl);
    const title = $link.text().trim();
    const url = $link.attr('href') ?? '';
    // Snippet is usually in the next sibling or a sibling td
    const snippet = $link
      .closest('tr,div')
      .next('tr,div')
      .find('.result-snippet, td.result-snippet')
      .text()
      .trim();
    if (title) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

// Run multiple queries in parallel and return de-duplicated results,
// trimmed to maxResults total.
export async function searchWebMulti(queries: string[], maxResultsPerQuery = 4, totalMax = 8): Promise<WebSearchResult[]> {
  const all = await Promise.all(queries.map((q) => searchWeb(q, maxResultsPerQuery)));
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const batch of all) {
    for (const r of batch) {
      const key = (r.url || r.title).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= totalMax) return out;
    }
  }
  return out;
}
