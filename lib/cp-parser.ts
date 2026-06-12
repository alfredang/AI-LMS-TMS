/**
 * Course Proposal parser — pure TypeScript port of `scripts/parse-cp.py`.
 *
 * Accepts a DOCX or XLSX buffer and returns plain text preserving the
 * document order, heading hierarchy (as Markdown `#`) and table structure
 * (as Markdown pipe tables), then trims to the CP's relevant sections.
 *
 * Matches the Streamlit `parse_cp_document()` behaviour so downstream agents
 * see the same content whether the file was parsed in Python or Node.
 */

import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const MAX_PROMPT_CHARS = 80000;

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&[a-z#0-9]+;/gi, (m) => {
    if (HTML_ENTITIES[m]) return HTML_ENTITIES[m];
    const numeric = m.match(/^&#(\d+);$/);
    if (numeric) return String.fromCharCode(Number(numeric[1]));
    const hex = m.match(/^&#x([0-9a-f]+);$/i);
    if (hex) return String.fromCharCode(parseInt(hex[1], 16));
    return m;
  });
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function buildMarkdownTable(tableHtml: string): string {
  const rows: string[][] = [];
  const rowMatches = tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rowMatch of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi);
    for (const cellMatch of cellMatches) {
      cells.push(stripTags(cellMatch[1]).replace(/\n/g, ' '));
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return '';

  const lines: string[] = [];
  let prev = '';
  for (const row of rows) {
    const rowStr = row.join(' | ');
    if (rowStr === prev) continue; // de-dup merged cells
    lines.push(`| ${rowStr} |`);
    prev = rowStr;
  }
  if (lines.length > 1) {
    const numCols = (lines[0].match(/\|/g) || []).length - 1;
    const sep = '|' + Array(numCols).fill('---').join('|') + '|';
    lines.splice(1, 0, sep);
  }
  return lines.join('\n');
}

/**
 * Walk mammoth's HTML output element-by-element (top-level siblings only)
 * and emit Markdown-style blocks matching the Python parser.
 */
function htmlToCpText(html: string): string {
  // mammoth wraps everything in ordered block elements; rip them apart.
  const blocks: string[] = [];
  const blockRe =
    /<(h[1-6]|p|table|ul|ol|pre|blockquote)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const inner = match[3];

    if (tag.startsWith('h')) {
      const level = Math.min(parseInt(tag.substring(1), 10) || 1, 4);
      const text = stripTags(inner);
      if (text) blocks.push(`${'#'.repeat(level)} ${text}`);
    } else if (tag === 'p') {
      const text = stripTags(inner);
      if (text) blocks.push(text);
    } else if (tag === 'table') {
      const md = buildMarkdownTable(match[0]);
      if (md) blocks.push(md);
    } else if (tag === 'ul' || tag === 'ol') {
      const listItems: string[] = [];
      const itemRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let itemMatch: RegExpExecArray | null;
      let idx = 1;
      while ((itemMatch = itemRe.exec(inner)) !== null) {
        const text = stripTags(itemMatch[1]);
        if (!text) continue;
        listItems.push(tag === 'ol' ? `${idx}. ${text}` : `- ${text}`);
        idx += 1;
      }
      if (listItems.length) blocks.push(listItems.join('\n'));
    } else {
      const text = stripTags(inner);
      if (text) blocks.push(text);
    }
  }

  return blocks.join('\n\n');
}

export async function parseDocxBuffer(buffer: Buffer): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return htmlToCpText(html);
}

export function parseXlsxBuffer(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sections: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const lines: string[] = [];
    for (const row of rows) {
      const cells = row.map((c: any) => (c === null || c === undefined ? '' : String(c).trim()));
      if (cells.some((c) => c.length > 0)) {
        lines.push(cells.join(' | '));
      }
    }
    if (lines.length) sections.push(`## ${sheetName}\n${lines.join('\n')}`);
  }
  return sections.join('\n\n');
}

export function trimDocxContent(text: string): string {
  const startMatch = text.match(/Part\s*1[\s\S]*?Particulars\s*of\s*Course/i);
  const endMatch = text.match(/Part\s*\d+[\s\S]*?Facilities\s*and\s*Resources/i);
  if (startMatch && startMatch.index !== undefined) {
    const startIdx = startMatch.index;
    if (endMatch && endMatch.index !== undefined) {
      const endIdx = endMatch.index + endMatch[0].length;
      text = text.substring(startIdx, endIdx);
    } else {
      text = text.substring(startIdx);
    }
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function trimXlsxContent(text: string): string {
  const startIdx = text.indexOf('1 - Course Particulars');
  const endIdx = text.indexOf('4 - Declarations');
  if (startIdx >= 0) {
    text = endIdx >= 0 ? text.substring(startIdx, endIdx) : text.substring(startIdx);
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export async function parseCpFile(buffer: Buffer, fileName: string): Promise<string> {
  const lower = fileName.toLowerCase();
  let text: string;
  if (lower.endsWith('.docx')) {
    text = await parseDocxBuffer(buffer);
    text = trimDocxContent(text);
  } else if (/\.xlsx?$/.test(lower)) {
    text = parseXlsxBuffer(buffer);
    text = trimXlsxContent(text);
  } else {
    text = buffer.toString('utf-8');
  }
  if (text.length > MAX_PROMPT_CHARS) {
    text = text.substring(0, MAX_PROMPT_CHARS) + '\n[Content truncated]';
  }
  return text;
}
