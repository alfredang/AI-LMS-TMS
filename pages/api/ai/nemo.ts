import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import pool from '../../../lib/db';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

async function getMiniMaxKey(): Promise<{ apiKey: string; model: string }> {
    // First try from training_provider_api table
    const result = await pool.query(`
        SELECT key_value, selected_model
        FROM training_provider_api
        WHERE training_provider_id = (
            SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1
        )
        AND key_name = 'MINIMAX_API_KEY'
        AND key_value IS NOT NULL AND key_value != ''
    `);

    if (result.rows.length > 0) {
        return {
            apiKey: result.rows[0].key_value,
            model: result.rows[0].selected_model || 'MiniMax-M2.7',
        };
    }

    // Fallback to environment variable
    if (process.env.MINIMAX_API_KEY) {
        return {
            apiKey: process.env.MINIMAX_API_KEY,
            model: 'MiniMax-M2.7',
        };
    }

    throw new Error('No MiniMax API key configured. Add one in Company Settings or set MINIMAX_API_KEY env var.');
}

function getNemoSystemPrompt(companyName: string) {
  return `You are Nemo, an AI operations assistant for ${companyName}'s LMS/TMS platform.
You help admins and training providers manage courses, trainers, learners, enrollments, and class operations.

You have access to the following tools to perform operations on the platform. Use them when the user asks you to take action.

When a user asks to assign a trainer to a course run:
1. If they provide the trainer's name (not email), use lookup_trainer_by_name first to find their email.
2. If multiple trainers match, show the list and ask the user to confirm which one.
3. Confirm the assignment details (trainer name/email + course run ID) with the user before executing assign_trainer.

When a user asks you to perform a destructive action (delete, remove, cancel), always confirm with them first before executing.
Be concise, professional, and proactive in suggesting next steps.
If you don't know something, say so honestly.
Format your responses clearly — use bullet points for lists, bold for emphasis.`;
}

// Tool definitions for Nemo (OpenAI function calling format)
const NEMO_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'search_course_runs',
            description: 'Search for course runs by title, course code, or course run ID. Returns a list of matching course runs with details.',
            parameters: {
                type: 'object',
                properties: {
                    search: { type: 'string', description: 'Search term (course title, code, or run ID)' },
                    status: { type: 'string', description: 'Filter by status: upcoming, ongoing, completed, or all', enum: ['upcoming', 'ongoing', 'completed', 'all'] },
                },
                required: ['search'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_trainers',
            description: 'List all trainers with their details including name, email, and assigned classes.',
            parameters: {
                type: 'object',
                properties: {
                    search: { type: 'string', description: 'Optional search term to filter trainers by name or email' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_learners',
            description: 'List learners with their details. Can search by name or email.',
            parameters: {
                type: 'object',
                properties: {
                    search: { type: 'string', description: 'Optional search term to filter learners by name or email' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_statistics',
            description: 'Get platform statistics including total learners, trainers, ongoing classes, upcoming classes, and completed classes.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'lookup_trainer_by_name',
            description: 'Look up a trainer by their name to find their email and details. Use this when a user refers to a trainer by name and you need their email for assignment.',
            parameters: {
                type: 'object',
                properties: {
                    trainerName: { type: 'string', description: 'The trainer name or partial name to search for' },
                },
                required: ['trainerName'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'assign_trainer',
            description: 'Assign a trainer to a course run. First use lookup_trainer_by_name to find the trainer email if the user provides a name instead of email. Always confirm with the user before executing this action.',
            parameters: {
                type: 'object',
                properties: {
                    courseRunId: { type: 'string', description: 'The course run ID (e.g., "1313594")' },
                    trainerEmail: { type: 'string', description: 'The email address of the trainer to assign' },
                },
                required: ['courseRunId', 'trainerEmail'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_course_run_enrollments',
            description: 'Get the list of enrolled learners for a specific course run.',
            parameters: {
                type: 'object',
                properties: {
                    courseRunId: { type: 'string', description: 'The course run ID' },
                },
                required: ['courseRunId'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'recommend_trainer',
            description: 'Recommend trainers for a specific course based on their past teaching history. Searches by course title or keyword and returns trainers who have previously taught matching courses.',
            parameters: {
                type: 'object',
                properties: {
                    courseTitle: { type: 'string', description: 'The course title or keyword to search for (e.g., "Business Innovation", "AI", "Data Analysis")' },
                },
                required: ['courseTitle'],
            },
        },
    },
];

// Tool execution functions
async function executeTool(name: string, input: any, req: NextApiRequest): Promise<string> {
    const baseUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

    switch (name) {
        case 'search_course_runs': {
            const status = input.status || 'all';
            let endpoint = '';
            if (status === 'upcoming') endpoint = '/api/admin/upcoming-classes';
            else if (status === 'ongoing') endpoint = '/api/admin/ongoing-classes';
            else if (status === 'completed') endpoint = '/api/admin/completed-classes';
            else endpoint = '/api/admin/search-course-runs';

            const url = new URL(endpoint, baseUrl);
            url.searchParams.set('search', input.search);
            url.searchParams.set('limit', '10');

            const res = await fetch(url.toString());
            const data = await res.json();
            return JSON.stringify(data.data || data.classes || data, null, 2);
        }

        case 'list_trainers': {
            const url = new URL('/api/admin/trainers-detail', baseUrl);
            const res = await fetch(url.toString());
            const data = await res.json();
            let trainers = data?.data?.trainers || data?.trainers || [];
            if (input.search) {
                const searchLower = input.search.toLowerCase();
                trainers = trainers.filter((t: any) =>
                    (t.trainer_name || '').toLowerCase().includes(searchLower) ||
                    (t.email || '').toLowerCase().includes(searchLower)
                );
            }
            return JSON.stringify(trainers.slice(0, 20), null, 2);
        }

        case 'list_learners': {
            const url = new URL('/api/admin/learners', baseUrl);
            if (input.search) url.searchParams.set('search', input.search);
            const res = await fetch(url.toString());
            const data = await res.json();
            const learners = (data.data || data.learners || []).slice(0, 20);
            return JSON.stringify(learners, null, 2);
        }

        case 'get_statistics': {
            const res = await fetch(new URL('/api/admin/statistics', baseUrl).toString());
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'lookup_trainer_by_name': {
            const trainerResult = await pool.query(
                `SELECT au.id, au.full_name AS name, au.email, tp.tel AS phone, tp.trainer_type,
                        COUNT(cr.id) as assigned_classes
                 FROM app_user au
                 JOIN trainer_profile tp ON tp.user_id = au.id
                 LEFT JOIN course_run cr ON cr.assigned_trainer_email = au.email
                 WHERE LOWER(au.full_name) LIKE LOWER($1)
                 GROUP BY au.id, au.full_name, au.email, tp.tel, tp.trainer_type
                 LIMIT 5`,
                [`%${input.trainerName}%`]
            );

            if (trainerResult.rows.length === 0) {
                return JSON.stringify({ error: `No trainer found matching "${input.trainerName}"`, suggestion: 'Try using list_trainers to see all available trainers.' });
            }

            return JSON.stringify(trainerResult.rows, null, 2);
        }

        case 'assign_trainer': {
            const lookupResult = await pool.query(
                `SELECT id, course_id FROM course_run WHERE course_run_id = $1`,
                [input.courseRunId]
            );
            if (lookupResult.rows.length === 0) {
                return JSON.stringify({ error: `Course run ${input.courseRunId} not found` });
            }

            const crId = lookupResult.rows[0].id;
            await pool.query(
                `UPDATE course_run SET assigned_trainer_email = $1 WHERE id = $2`,
                [input.trainerEmail, crId]
            );

            return JSON.stringify({ success: true, message: `Trainer ${input.trainerEmail} assigned to course run ${input.courseRunId}` });
        }

        case 'recommend_trainer': {
            // First: find trainers who have previously taught matching courses
            const taughtResult = await pool.query(
                `SELECT au.full_name AS trainer_name, au.email, tp.trainer_type,
                        tp.areas_of_expertise, tp.qualifications,
                        c.title AS course_title, COUNT(cr.id) AS times_taught
                 FROM app_user au
                 JOIN trainer_profile tp ON tp.user_id = au.id
                 JOIN course_run cr ON cr.assigned_trainer_email = au.email
                 JOIN course c ON c.id = cr.course_id
                 WHERE LOWER(c.title) LIKE LOWER($1)
                 GROUP BY au.full_name, au.email, tp.trainer_type, tp.areas_of_expertise, tp.qualifications, c.title
                 ORDER BY times_taught DESC
                 LIMIT 10`,
                [`%${input.courseTitle}%`]
            );

            // Second: find trainers by skill/expertise match
            const searchTerms = input.courseTitle.split(/\s+/).filter((w: string) => w.length > 2);
            const expertiseConditions = searchTerms.map((_: string, i: number) => `tp.areas_of_expertise::text ILIKE $${i + 1}`).join(' OR ');
            const expertiseResult = searchTerms.length > 0 ? await pool.query(
                `SELECT DISTINCT au.full_name AS trainer_name, au.email, tp.trainer_type,
                        tp.areas_of_expertise, tp.qualifications
                 FROM app_user au
                 JOIN trainer_profile tp ON tp.user_id = au.id
                 WHERE (${expertiseConditions})
                 AND tp.areas_of_expertise IS NOT NULL
                 AND tp.areas_of_expertise != '[]'::jsonb
                 AND tp.areas_of_expertise != '{}'::jsonb
                 LIMIT 10`,
                searchTerms.map((t: string) => `%${t}%`)
            ) : { rows: [] };

            const results: any = {};
            if (taughtResult.rows.length > 0) {
                results.previously_taught = taughtResult.rows;
            }
            if (expertiseResult.rows.length > 0) {
                // Filter out trainers already in previously_taught
                const taughtEmails = new Set(taughtResult.rows.map((r: any) => r.email));
                const additional = expertiseResult.rows.filter((r: any) => !taughtEmails.has(r.email));
                if (additional.length > 0) {
                    results.matching_expertise = additional;
                }
            }

            if (!results.previously_taught && !results.matching_expertise) {
                return JSON.stringify({
                    message: `No trainers found matching "${input.courseTitle}".`,
                    suggestion: 'Try a broader search term like the domain (e.g., "AI", "Finance", "Marketing").'
                });
            }

            return JSON.stringify({
                message: `Trainer recommendations for "${input.courseTitle}":`,
                ...results
            }, null, 2);
        }

        case 'get_course_run_enrollments': {
            const url = new URL('/api/admin/course-run-enrollments', baseUrl);
            url.searchParams.set('courseRunId', input.courseRunId);
            const res = await fetch(url.toString());
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        default:
            return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { messages, systemPrompt } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Messages array is required' });
        }

        const { apiKey, model } = await getMiniMaxKey();
        const tp = await getTrainingPartnerIdentifiers();
        const client = new OpenAI({ apiKey, baseURL: 'https://api.minimax.io/v1' });

        // Convert messages to OpenAI format
        const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt || getNemoSystemPrompt(tp.companyShortname || tp.name || 'Training Provider') },
            ...messages.map((m: any) => ({
                role: (m.role === 'model' ? 'assistant' : m.role) as 'user' | 'assistant',
                content: m.content || m.text,
            })),
        ];

        // Agentic loop — keep calling until no more tool calls
        let currentMessages = [...openaiMessages];
        let finalText = '';
        let iterations = 0;
        const maxIterations = 5;

        while (iterations < maxIterations) {
            iterations++;

            const response = await client.chat.completions.create({
                model,
                max_tokens: 4096,
                messages: currentMessages,
                tools: NEMO_TOOLS,
            });

            const choice = response.choices[0];
            const message = choice.message;

            // Collect assistant text
            if (message.content) {
                finalText += message.content;
            }

            // If no tool calls, we're done
            if (!message.tool_calls || message.tool_calls.length === 0 || choice.finish_reason !== 'tool_calls') {
                break;
            }

            // Add assistant message with tool calls to conversation
            currentMessages.push(message);

            // Execute each tool call and add results
            for (const toolCall of message.tool_calls) {
                const tc = toolCall as any;
                const fnName = tc.function?.name as string;
                const fnArgs = JSON.parse(tc.function?.arguments ?? '{}');
                console.log(`🔧 Nemo executing tool: ${fnName}`, fnArgs);

                const result = await executeTool(fnName, fnArgs, req);
                currentMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: result,
                });
            }
        }

        // Strip <think>...</think> reasoning tags from model output
        const cleanedText = finalText.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

        return res.status(200).json({
            text: cleanedText,
            model,
            provider: 'openai',
            agent: 'nemo',
        });
    } catch (error: any) {
        console.error('Nemo agent error:', error);
        return res.status(500).json({
            error: error.message || 'Nemo encountered an error',
            details: error.message,
        });
    }
}
