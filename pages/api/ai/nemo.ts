import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import pool from '../../../lib/db';

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

const NEMO_SYSTEM_PROMPT = `You are Nemo, an AI operations assistant for Tertiary Infotech Academy's LMS/TMS platform.
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
            const url = new URL('/api/admin/trainers', baseUrl);
            if (input.search) url.searchParams.set('search', input.search);
            const res = await fetch(url.toString());
            const data = await res.json();
            const trainers = (data.data || data.trainers || []).slice(0, 20);
            return JSON.stringify(trainers, null, 2);
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
                `SELECT t.id, t.name, t.email, t.phone, t.trainer_type,
                        COUNT(cr.id) as assigned_classes
                 FROM trainer t
                 LEFT JOIN course_run cr ON cr.assigned_trainer_email = t.email
                 WHERE LOWER(t.name) LIKE LOWER($1)
                 GROUP BY t.id, t.name, t.email, t.phone, t.trainer_type
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
        const client = new OpenAI({ apiKey, baseURL: 'https://api.minimax.io/v1' });

        // Convert messages to OpenAI format
        const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt || NEMO_SYSTEM_PROMPT },
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
                const fnName = toolCall.function.name;
                const fnArgs = JSON.parse(toolCall.function.arguments);
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
