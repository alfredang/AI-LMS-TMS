import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import {
  CP_PROMPT_PLACEHOLDERS,
  CP_PROMPT_SECTION_LABELS,
  CpPromptSection,
  DEFAULT_CP_PROMPTS,
} from '../../../lib/cp-prompts';

type TemplateRow = {
  section: string;
  custom: string | null;
  default: string;
  placeholders: readonly string[];
  label: string;
  updatedAt: string | null;
};

async function fetchCustomTemplates(): Promise<Record<string, { template: string; updated_at: string }>> {
  const result = await pool.query<{ section: string; template: string; updated_at: Date }>(
    'SELECT section, template, updated_at FROM cp_prompt_template'
  );
  const map: Record<string, { template: string; updated_at: string }> = {};
  for (const row of result.rows) {
    map[row.section] = {
      template: row.template,
      updated_at: row.updated_at.toISOString(),
    };
  }
  return map;
}

function isValidSection(section: unknown): section is CpPromptSection {
  return typeof section === 'string' && section in DEFAULT_CP_PROMPTS;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const custom = await fetchCustomTemplates();
      const sections: TemplateRow[] = (Object.keys(DEFAULT_CP_PROMPTS) as CpPromptSection[]).map(section => ({
        section,
        label: CP_PROMPT_SECTION_LABELS[section],
        default: DEFAULT_CP_PROMPTS[section],
        custom: custom[section]?.template ?? null,
        placeholders: CP_PROMPT_PLACEHOLDERS[section],
        updatedAt: custom[section]?.updated_at ?? null,
      }));
      return res.status(200).json({ success: true, sections });
    }

    if (req.method === 'PUT') {
      const { section, template } = req.body ?? {};
      if (!isValidSection(section)) {
        return res.status(400).json({ error: 'Invalid or missing section' });
      }
      if (typeof template !== 'string') {
        return res.status(400).json({ error: 'template must be a string' });
      }
      // Empty string → treat as "reset to default" by deleting the row.
      if (template.trim() === '' || template === DEFAULT_CP_PROMPTS[section]) {
        await pool.query('DELETE FROM cp_prompt_template WHERE section = $1', [section]);
        return res.status(200).json({ success: true, reverted: true });
      }
      await pool.query(
        `INSERT INTO cp_prompt_template (section, template, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (section) DO UPDATE
         SET template = EXCLUDED.template, updated_at = NOW()`,
        [section, template]
      );
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('cp-templates error:', error);
    return res.status(500).json({ error: error.message || 'Unknown error' });
  }
}
