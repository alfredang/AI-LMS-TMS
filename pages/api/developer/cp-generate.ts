import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@anthropic-ai/claude-agent-sdk';
import pool from '../../../lib/db';
import { buildClaudeEnv } from '../../../lib/anthropic-auth';

// ─── Prompt Templates ───

const GENERATE_TOPICS_PROMPT = `You are an expert instructional designer specializing in Singapore's WSQ and CASL training frameworks.

Generate exactly {num_topics} course topics for the following course:
Course Title: {course_title}
Framework: {framework}
{skill_context}

Each topic should:
- Be relevant to the course title and framework
- Follow a logical learning progression
- Be suitable for professional adult learners in Singapore

Format your output using markdown headers:
## Topic 1: [Topic Name]
- Subtopic A
- Subtopic B
- Subtopic C

## Topic 2: [Topic Name]
...

Respond with ONLY the topics, nothing else.`;

const ABOUT_COURSE_PROMPT = `You are an expert course writer for Singapore's professional training industry.

Write a professional course description for:
Course Title: {course_title}
Course Topics: {course_topics}

Guidelines:
- Write 80-120 words as a single cohesive paragraph
- Professional tone suitable for SSG course proposals
- Highlight key skills and knowledge learners will gain
- Do not use markdown formatting, bullet points, or headers
- Do not mention specific topic numbers

Respond with ONLY the course description paragraph, nothing else.`;

const WHAT_YOULL_LEARN_PROMPT = `You are an expert course writer for Singapore's professional training industry.

Generate learning highlights for:
Course Title: {course_title}
Course Topics: {course_topics}

Guidelines:
- Write 3-5 bullet-point learning outcomes
- Each bullet should be 40-60 words
- Start each with an action verb
- Use bullet character (•) followed by a space
- Separate each bullet with a blank line
- Professional tone suitable for SSG course proposals

Respond with ONLY the bullet points, nothing else.`;

const BACKGROUND_A_PROMPT = `You are an expert instructional designer writing a course proposal background for SSG Singapore.

Write Background Part A for:
Course Title: {course_title}
Course Topics: {course_topics}

This section must cover:
- Targeted sectors and industry segments
- Current industry pressures and trends driving the need for this training
- Target audience description
- Skills gaps this course addresses

Guidelines:
- Write 2-3 paragraphs, 100-200 words total
- Professional academic tone
- Reference Singapore's industry context
- Do not use bullet points or markdown headers

Respond with ONLY the background text, nothing else.`;

const BACKGROUND_B_PROMPT = `You are an expert instructional designer writing a course proposal background for SSG Singapore.

Write Background Part B for:
Course Title: {course_title}
Course Topics: {course_topics}

This section must cover:
- Performance gaps identified in the industry
- How these gaps were identified (reference Skills Framework methodology)
- Specific benefits for learners upon completion

Guidelines:
- Write paragraphs followed by 3-5 bullet-point benefits
- Benefits should start with action verbs
- Use bullet character (•) for benefits
- Professional academic tone
- 150-250 words total

Respond with ONLY the background text, nothing else.`;

const LEARNING_OUTCOMES_PROMPT = `You are an expert instructional designer creating learning outcomes for SSG Singapore course proposals.

Generate learning outcomes for:
Course Title: {course_title}
Course Topics: {course_topics}

Guidelines:
- One learning outcome per topic
- Format: T1: [Topic Name]\\nLO1: [Learning outcome text]
- Each LO must start with an action verb (Apply, Analyze, Evaluate, etc.)
- Each LO must be under 25 words
- Each LO should summarize the entire topic's learning goal
- Separate each topic/LO pair with a blank line

Respond with ONLY the learning outcomes, nothing else.`;

const INSTRUCTION_METHOD_PROMPT = `You are an expert instructional designer explaining teaching methodologies for SSG Singapore course proposals.

Elaborate on why the following instructional method is appropriate:
Method: {method_name}
Course Title: {course_title}
Course Topics: {course_topics}

Guidelines:
- Write 4-5 paragraphs (250-400 words)
- Explain why this method suits the course content
- Describe how it will be implemented
- Connect to specific course topics where relevant
- Professional academic tone

Respond with ONLY the elaboration, nothing else.`;

const ASSESSMENT_METHOD_PROMPT = `You are an expert instructional designer explaining assessment methodologies for SSG Singapore course proposals.

Elaborate on why the following assessment method is appropriate:
Method: {method_name}
Course Title: {course_title}
Course Topics: {course_topics}

Guidelines:
- Write 2-3 paragraphs (100-200 words)
- Explain why this assessment method suits the course
- Describe how it evaluates learner competency
- Professional academic tone

Respond with ONLY the elaboration, nothing else.`;

const LU_SEQUENCING_PROMPT = `You are an expert instructional designer writing LU sequencing rationale for SSG Singapore course proposals.

Write a sequencing rationale for:
Course Title: {course_title}
Course Topics: {course_topics}
Learning Outcomes: {learning_outcomes}
Sequencing Type: {sequencing_type}

Guidelines:
- Explain why the "{sequencing_type}" approach is used
- Provide a justification paragraph
- Then explain the rationale for each Learning Unit's position in sequence
- Professional academic tone
- 200-400 words total

Respond with ONLY the sequencing rationale, nothing else.`;

const COURSE_OUTLINE_PROMPT = `You are an expert instructional designer creating a course outline for SSG Singapore course proposals.

Generate a course outline for:
Course Title: {course_title}
Course Topics: {course_topics}
Instructional Methods: {instructional_methods}
Duration Per Topic: approximately {duration_per_topic} hours each

The outline must have 3 sections:
1. Topics and subtopics covered
2. Instructional methods used per topic
3. Duration allocation per topic

Guidelines:
- Maximum 2000 characters
- Concise and structured
- Professional tone

Respond with ONLY the course outline, nothing else.`;

const ENTRY_REQUIREMENTS_PROMPT = `You are an expert instructional designer writing minimum entry requirements for SSG Singapore course proposals.

Generate entry requirements for:
Course Title: {course_title}
Course Topics: {course_topics}

Structure the output as:
Knowledge & Skills:
• [requirements]

Attitude:
• [requirements]

Experience:
• [requirements]

Age Group:
• [requirements]

Guidelines:
- Use bullet character (•) for each item
- Professional tone suitable for SSG course proposals
- Requirements should be realistic and relevant

Respond with ONLY the requirements, nothing else.`;

const JOB_ROLES_PROMPT = `You are an expert career consultant familiar with Singapore's SSG Skills Framework.

Generate job roles for:
Course Title: {course_title}
Course Topics: {course_topics}

Guidelines:
- Generate exactly 10 job roles
- Follow SSG Skills Framework naming conventions
- Comma-separated on a single line
- No descriptions, just role titles
- Relevant to the course content and Singapore market

Respond with ONLY the comma-separated job roles, nothing else.`;

const LESSON_PLAN_PROMPT = `You are an expert instructional designer creating a lesson plan for SSG Singapore course proposals.

Generate a day-by-day lesson plan for:
Course Title: {course_title}
Course Topics: {course_topics}
Total Course Duration: {course_duration} hours
Instructional Hours: {instructional_hours} hours
Assessment Hours: {assessment_hours} hours
Number of Topics: {num_topics}

Scheduling Rules:
- Daily hours: 9:00 AM - 6:00 PM (480 minutes total)
- Lunch: Fixed 12:30 PM - 1:15 PM (45 minutes)
- Assessment: Fixed 4:00 PM - 6:00 PM on last day only
- Topic duration: Equal time = instructional_hours * 60 / num_topics minutes each
- Topics CAN split across lunch or day boundaries with "(Cont'd)" suffix
- Fill remaining time with "Break" entries

Format each entry as:
Day X:
HH:MM AM/PM - HH:MM AM/PM | Duration (min) | Description

Respond with ONLY the lesson plan, nothing else.`;

const VALIDATION_PROMPT = `You are an expert course validation consultant for SSG Singapore.

Generate course validation survey responses for:
Course Title: {course_title}
Course Topics: {course_topics}
Learning Outcomes: {learning_outcomes}

Generate 5 distinct survey response sets. Each set has 2 questions:
1. What are the performance gaps in the industry that this course addresses?
2. Why does this course address the training needs?

Guidelines:
- 1-2 paragraphs per question, under 120 words each
- Each set should use different learning outcomes as examples
- Professional tone
- Number each set clearly (Set 1, Set 2, etc.)

Respond with ONLY the survey response sets, nothing else.`;

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

// ─── Handler ───

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { section } = req.body;
  if (!section) {
    return res.status(400).json({ error: 'Missing section parameter' });
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured. Please set it in Company Settings > LLM Credentials.' });
  }

  try {
    const {
      courseTitle = '',
      courseTopics = '',
      courseDuration = '16',
      numTopics = '4',
      instructionalHours = '12',
      assessmentHours = '4',
      framework = 'wsq',
      tscRefCode = '',
      tscTitle = '',
      uniqueSkillName = '',
      selectedInstrMethods = [],
      selectedAssessMethods = [],
      luSequencingType = 'Step by Step',
      learningOutcomes = '',
      courseOutline = '',
    } = req.body;

    const vars: Record<string, string> = {
      course_title: courseTitle,
      course_topics: courseTopics,
      course_duration: String(courseDuration),
      num_topics: String(numTopics),
      instructional_hours: String(instructionalHours),
      assessment_hours: String(assessmentHours),
      framework: framework.toUpperCase(),
      tsc_ref_code: tscRefCode,
      tsc_title: tscTitle,
      unique_skill_name: uniqueSkillName,
      instructional_methods: (selectedInstrMethods as string[]).join(', '),
      assessment_methods_list: (selectedAssessMethods as string[]).join(', '),
      sequencing_type: luSequencingType,
      learning_outcomes: learningOutcomes,
      course_outline: courseOutline,
      duration_per_topic: String(Math.round(Number(instructionalHours) / Number(numTopics) * 10) / 10),
      skill_context: uniqueSkillName ? `Unique Skill Name: ${uniqueSkillName}` : '',
    };

    // Handle method sections (generate for each selected method)
    if (section === 'instructional_methods') {
      const methods = selectedInstrMethods as string[];
      if (methods.length === 0) {
        return res.status(400).json({ error: 'No instructional methods selected.' });
      }
      const results: Record<string, string> = {};
      for (const method of methods) {
        const prompt = buildPrompt(INSTRUCTION_METHOD_PROMPT, { ...vars, method_name: method });
        results[method] = await generateWithClaude(prompt, apiKey);
      }
      return res.status(200).json({ success: true, results });
    }

    if (section === 'assessment_methods') {
      const methods = selectedAssessMethods as string[];
      if (methods.length === 0) {
        return res.status(400).json({ error: 'No assessment methods selected.' });
      }
      const results: Record<string, string> = {};
      for (const method of methods) {
        const prompt = buildPrompt(ASSESSMENT_METHOD_PROMPT, { ...vars, method_name: method });
        results[method] = await generateWithClaude(prompt, apiKey);
      }
      return res.status(200).json({ success: true, results });
    }

    // Single-output sections
    const templateMap: Record<string, string> = {
      generate_topics: GENERATE_TOPICS_PROMPT,
      about_course: ABOUT_COURSE_PROMPT,
      what_youll_learn: WHAT_YOULL_LEARN_PROMPT,
      background_a: BACKGROUND_A_PROMPT,
      background_b: BACKGROUND_B_PROMPT,
      learning_outcomes: LEARNING_OUTCOMES_PROMPT,
      lu_sequencing: LU_SEQUENCING_PROMPT,
      course_outline: COURSE_OUTLINE_PROMPT,
      entry_requirements: ENTRY_REQUIREMENTS_PROMPT,
      job_roles: JOB_ROLES_PROMPT,
      lesson_plan: LESSON_PLAN_PROMPT,
      validation: VALIDATION_PROMPT,
    };

    const template = templateMap[section];
    if (!template) {
      return res.status(400).json({ error: `Unknown section: ${section}` });
    }

    const prompt = buildPrompt(template, vars);
    const result = await generateWithClaude(prompt, apiKey);

    return res.status(200).json({ success: true, result });
  } catch (error: any) {
    console.error('CP generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate CP content' });
  }
}
