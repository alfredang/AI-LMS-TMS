import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@anthropic-ai/claude-agent-sdk';
import pool from '../../../lib/db';
import { buildClaudeEnv } from '../../../lib/anthropic-auth';
import { CpPromptSection, DEFAULT_CP_PROMPTS } from '../../../lib/cp-prompts';

// ─── Helpers ───

async function getApiKey(): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT key_value FROM training_provider_api
       WHERE training_provider_id = (SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1)
       AND key_name = 'ANTHROPIC_API_KEY'`
    );
    if (result.rows.length > 0 && result.rows[0].key_value) {
      return result.rows[0].key_value;
    }
  } catch (e) {
    console.error('Failed to fetch API key from DB:', e);
  }
  return process.env.ANTHROPIC_API_KEY || null;
}

// Resolves the prompt template for a section: prefer the DB override if
// present, else the built-in default. Loading from DB swallows errors so a
// missing `cp_prompt_template` table (e.g. migration not yet run) degrades
// gracefully to defaults rather than 500-ing.
async function resolveTemplate(section: CpPromptSection): Promise<string> {
  try {
    const result = await pool.query<{ template: string }>(
      'SELECT template FROM cp_prompt_template WHERE section = $1',
      [section]
    );
    if (result.rows.length > 0 && result.rows[0].template) {
      return result.rows[0].template;
    }
  } catch (e) {
    console.error(`Failed to load cp_prompt_template for section=${section}:`, e);
  }
  return DEFAULT_CP_PROMPTS[section];
}

async function generateWithClaude(prompt: string, apiKey: string): Promise<string> {
  let resultText = '';

  for await (const message of query({
    prompt,
    options: {
      env: buildClaudeEnv(apiKey),
      allowedTools: [],
      maxTurns: 1,
    },
  })) {
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          resultText += block.text;
        }
      }
    }
  }

  if (!resultText) {
    throw new Error('No response from Claude. Please try again.');
  }

  return resultText;
}

function buildPrompt(template: string, vars: Record<string, string>): string {
  let prompt = template;
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }
  return prompt;
}

function isValidSection(section: unknown): section is CpPromptSection {
  return typeof section === 'string' && section in DEFAULT_CP_PROMPTS;
}

// ─── Handler ───

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { section } = req.body;
  if (!isValidSection(section)) {
    return res.status(400).json({ error: 'Missing or unknown section' });
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured. Please set it in Company Settings > LLM Credentials.' });
  }

  try {
    const {
      courseTitle = '',
      courseTopic = '',
      courseTopics = '',
      courseDuration = '16',
      numTopics = '4',
      instructionalHours = '12',
      assessmentHours = '4',
      framework = 'wsq',
      tscRefCode = '',
      tscTitle = '',
      uniqueSkillName = '',
      uniqueSkillDescription = '',
      selectedInstrMethods = [],
      selectedAssessMethods = [],
      luSequencingType = 'Step by Step',
      learningOutcomes = '',
      courseOutline = '',
    } = req.body;

    // Duration per topic in minutes (Streamlit course-outline template expects mins).
    const durationPerTopicMinutes = Number(numTopics) > 0
      ? Math.round(Number(instructionalHours) * 60 / Number(numTopics))
      : 0;

    const vars: Record<string, string> = {
      course_title: courseTitle,
      // Streamlit's LU Sequencing, Validation and Suggest-Titles templates
      // reference the bare `{course}` placeholder. For suggest_titles the
      // user types the topic into a dedicated field (courseTopic); for all
      // other sections it falls back to the course title.
      course: section === 'suggest_titles' ? (courseTopic || courseTitle) : courseTitle,
      course_topics: courseTopics,
      course_duration: String(courseDuration),
      num_topics: String(numTopics),
      instructional_hours: String(instructionalHours),
      // Alias so `{instructional_duration}` (Streamlit name) also resolves.
      instructional_duration: String(instructionalHours),
      assessment_hours: String(assessmentHours),
      assessment_duration: String(assessmentHours),
      framework: framework.toUpperCase(),
      tsc_ref_code: tscRefCode,
      tsc_title: tscTitle,
      unique_skill_name: uniqueSkillName,
      instructional_methods: (selectedInstrMethods as string[]).join(', '),
      assessment_methods: (selectedAssessMethods as string[]).join(', '),
      assessment_methods_list: (selectedAssessMethods as string[]).join(', '),
      sequencing_type: luSequencingType,
      learning_outcomes: learningOutcomes,
      course_outline: courseOutline,
      duration_per_topic: String(durationPerTopicMinutes),
      // Validation prompt takes an `{industry}` token that the Next.js UI
      // doesn't expose — leave blank so the rendered prompt reads cleanly.
      industry: '',
      skill_context: uniqueSkillName ? `Unique Skill Name: ${uniqueSkillName}` : '',
    };

    // Streamlit-parity variables for the Generate Topics prompt.
    // Derive days from numTopics so "max 3 per day" stays consistent with the
    // user's chosen topic count, even though the Next.js UI takes hours (not
    // days) as input.
    const numTopicsNum = Math.max(1, Number(numTopics) || 1);
    const derivedDays = Math.max(1, Math.ceil(numTopicsNum / 3));
    const hasSkill = Boolean(uniqueSkillName && uniqueSkillDescription);
    vars.num_days = String(derivedDays);
    vars.max_topics = String(numTopicsNum);
    vars.skill_context = hasSkill
      ? `\nCASL Skill Description (use this as context to generate relevant topics):\n${uniqueSkillDescription}\n`
      : '';
    vars.skill_guideline = hasSkill ? ' and the CASL skill description above' : '';
    vars.special_requirements = '';

    // Method sections generate once per selected method, sharing the same
    // template plus a per-method `method_name` variable.
    if (section === 'instructional_methods') {
      const methods = selectedInstrMethods as string[];
      if (methods.length === 0) {
        return res.status(400).json({ error: 'No instructional methods selected.' });
      }
      const template = await resolveTemplate('instructional_methods');
      const results: Record<string, string> = {};
      for (const method of methods) {
        const prompt = buildPrompt(template, { ...vars, method_name: method });
        results[method] = await generateWithClaude(prompt, apiKey);
      }
      return res.status(200).json({ success: true, results });
    }

    if (section === 'assessment_methods') {
      const methods = selectedAssessMethods as string[];
      if (methods.length === 0) {
        return res.status(400).json({ error: 'No assessment methods selected.' });
      }
      const template = await resolveTemplate('assessment_methods');
      const results: Record<string, string> = {};
      for (const method of methods) {
        const prompt = buildPrompt(template, { ...vars, method_name: method });
        results[method] = await generateWithClaude(prompt, apiKey);
      }
      return res.status(200).json({ success: true, results });
    }

    const template = await resolveTemplate(section);
    const prompt = buildPrompt(template, vars);
    const result = await generateWithClaude(prompt, apiKey);

    return res.status(200).json({ success: true, result });
  } catch (error: any) {
    console.error('CP generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate CP content' });
  }
}
