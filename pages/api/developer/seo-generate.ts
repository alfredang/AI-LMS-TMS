import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@anthropic-ai/claude-agent-sdk';
import pool from '../../../lib/db';

const SEO_WSQ_TEMPLATE = `As a digital marketing consultant, your primary role is to assist small business owners in optimizing their websites for SEO and improving their digital marketing strategies to enhance lead generation. You should provide clear, actionable advice tailored to the challenges and opportunities typical for small businesses. Focus on offering strategies that are feasible and effective for smaller budgets and resources. Stay abreast of the latest SEO and digital marketing trends, ensuring your advice is current and practical. Personalize your responses to reflect an understanding of the unique dynamics and constraints small businesses face in digital marketing.

You will create keywords-rich SEO meta title, keywords, description, course description and job roles for the following WSQ course.

Course Title: {course_title}
Learning Outcomes: {learning_outcomes}
Course Topics: {topics}

Rules:
- Your SEO meta description has to be less than 255 characters
- You don't mention the types of courses such as online or physical
- Do not add quotes or quotation marks to your output
- You must consider the learning outcomes and topics for Course Description
- You need to take into consideration of the Learning Outcomes when drafting the course description
- Add "WSQ" as the first word in meta title
- Do not insert LO# to the course description
- Please bold the headers
- Do not put quotes on the sentences and meta, do not say paragraph 1 and 2
- Format the output in clean Markdown

Your output format is as follows:
1. **SEO Meta Title:** WSQ .... | Tertiary Courses Singapore
2. **SEO Meta Keywords:**
3. **SEO Meta Description:** (append "Enjoy up to 70% WSQ funding subsidy.")
4. **SEO Course Description** in two paragraphs
5. **20 Job Roles** in bullet points related to the course`;

const SEO_NON_WSQ_TEMPLATE = `As a digital marketing consultant, your primary role is to assist small business owners in optimizing their websites for SEO and improving their digital marketing strategies to enhance lead generation.

You will create keywords-rich SEO meta title, meta keywords, meta description, course description, and job roles for the following course.

Course Title: {course_name}
Course Topics and Outline: {key_topics}
Course Highlights: {course_highlights}

You should provide clear, actionable advice tailored to the challenges and opportunities typical for small businesses. Focus on offering strategies that are feasible and effective for smaller budgets and resources. Stay abreast of the latest SEO and digital marketing trends, ensuring your advice is current and practical. Personalize your responses to reflect an understanding of the unique dynamics and constraints small businesses face in digital marketing.

Rules:
- Your SEO meta description has to be less than 255 characters
- You don't mention the types of courses such as online or physical
- Do not add quotes or quotation marks to your output
- Your meta pitch should appeal to the audience
- Write the course description in a professional tone
- Your meta title should be longer and more pitchy
- Your course description takes into consideration the course highlights
- Your course description should be pitchy and professional
- Please bold the headers
- Format the output in clean Markdown

Your output format is as follows:
1. **SEO Course Description** in two paragraphs
2. **SEO Meta Title for Singapore:** .... | Tertiary Courses Singapore
3. **SEO Meta Title for Other Countries:** .... | Tertiary Courses
4. **SEO Meta Title for Malaysia:** HRD Corp Funded .... | Tertiary Courses Malaysia
5. **SEO Meta Keywords:**
6. **SEO Meta Description:**
7. **20 Job Roles** in bullet points related to the course`;

async function getApiKey(): Promise<{ key: string; envVar: string } | null> {
  // Try DB first
  try {
    const result = await pool.query(
      `SELECT key_value FROM training_provider_api
       WHERE training_provider_id = (SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1)
       AND key_name = 'ANTHROPIC_API_KEY'`
    );
    if (result.rows.length > 0 && result.rows[0].key_value) {
      const key = result.rows[0].key_value;
      // Subscription/OAuth tokens (sk-ant-oat*) use ANTHROPIC_AUTH_TOKEN
      // Standard API keys (sk-ant-api*) use ANTHROPIC_API_KEY
      const envVar = key.startsWith('sk-ant-oat') ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY';
      return { key, envVar };
    }
  } catch (e) {
    console.error('Failed to fetch API key from DB:', e);
  }
  // Fallback to env var
  if (process.env.ANTHROPIC_API_KEY) {
    return { key: process.env.ANTHROPIC_API_KEY, envVar: 'ANTHROPIC_API_KEY' };
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, fields } = req.body;

  if (!type || !fields) {
    return res.status(400).json({ error: 'Missing type or fields' });
  }

  const apiConfig = await getApiKey();
  if (!apiConfig) {
    return res.status(500).json({ error: 'API key not configured. Please set it in Company Settings > LLM Credentials.' });
  }

  let prompt: string;
  if (type === 'wsq') {
    prompt = SEO_WSQ_TEMPLATE
      .replace('{course_title}', fields.course_title || '')
      .replace('{learning_outcomes}', fields.learning_outcomes || '')
      .replace('{topics}', fields.topics || '');
  } else {
    prompt = SEO_NON_WSQ_TEMPLATE
      .replace('{course_name}', fields.course_name || '')
      .replace('{key_topics}', fields.key_topics || '')
      .replace('{course_highlights}', fields.course_highlights || '');
  }

  try {
    let resultText = '';

    for await (const message of query({
      prompt,
      options: {
        env: { ...process.env, [apiConfig.envVar]: apiConfig.key },
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
      return res.status(500).json({ error: 'No response from Claude. Please try again.' });
    }

    return res.status(200).json({ success: true, result: resultText });
  } catch (error: any) {
    console.error('SEO generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate SEO content' });
  }
}
