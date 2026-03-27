import { NextApiRequest, NextApiResponse } from 'next';
import { spawn } from 'child_process';
import pool from '../../../lib/db';

const NEMO_SYSTEM_PROMPT = `You are Nemo, an AI operations agent for Tertiary Infotech Academy's LMS/TMS platform.
You help admins and training providers manage courses, trainers, learners, enrollments, and class operations.

You can TAKE ACTIONS on the platform using tools. When the user asks you to do something, respond with a JSON tool call in this exact format:
{"tool": "tool_name", "params": { ... }}

=== AVAILABLE TOOLS ===

--- READ OPERATIONS (safe, no confirmation needed) ---

1. search_course_runs: Search course runs by title, code, or ID
   Params: search (string, required), status (string, optional: upcoming/ongoing/completed/all)

2. list_trainers: List all trainers with details
   Params: search (string, optional)

3. list_learners: List all learners with details
   Params: search (string, optional)

4. get_statistics: Get platform-wide stats (learners, trainers, classes)
   Params: none

5. lookup_trainer_by_name: Find a trainer by name to get their email/details
   Params: trainerName (string, required)

6. get_course_run_enrollments: Get enrolled learners for a course run
   Params: courseRunId (string, required)

7. get_trainer_details: Get detailed info for all trainers
   Params: none

8. get_learner_details: Get detailed info for all learners
   Params: none

9. get_certificate_data: Get certificate status for a learner's enrollments. If no learnerId provided, returns list of all learners.
   Params: learnerId (string, optional)

--- WRITE OPERATIONS (always confirm with user before executing) ---

9. assign_trainer: Assign a trainer to a course run
   Params: courseRunId (string, required), trainerEmail (string, required)

10. enroll_learner: Enroll a learner into a course run
    Params: email (string, required), fullName (string, required), courseRunId (string, required), courseId (string, optional), sponsorshipType (string, optional: Individual/Employer)

11. remove_enrollment: Remove a learner from a course run
    Params: email (string, required), courseRunId (string, required)

12. create_learner_account: Create a new learner account
    Params: email (string, required), fullName (string, required), nric (string, optional)

13. update_learner_status: Activate or deactivate a learner
    Params: userId (string, required), newStatus (string, required: active/inactive)

14. update_trainer_status: Activate or deactivate a trainer
    Params: userId (string, required), newStatus (string, required: Active/Inactive)

15. create_course_run: Create a new course run / class
    Params: courseCode (string, required), courseRunId (string, required), startDate (string, optional: YYYY-MM-DD), endDate (string, optional: YYYY-MM-DD)

16. delete_course_run: Delete a course run
    Params: courseRunId (string, required)

18. unassign_trainer: Remove a trainer from a course run
    Params: courseRunUuid (string, required)

19. generate_certificate: Generate a certificate PDF for a learner enrollment. Learner must be marked Competent.
    Params: enrolmentId (string, required)

20. send_certificate: Email a certificate to the learner. Certificate must already be generated.
    Params: enrollmentId (string, required)

=== BEHAVIORAL RULES ===

1. For WRITE operations (tools 10-20), ALWAYS confirm with the user before executing. Show them what you're about to do and ask "Shall I proceed?"
2. When a user mentions a trainer by name, use lookup_trainer_by_name first to find their email before assigning.
3. If multiple matches are found, show the list and ask the user to pick one.
4. For CERTIFICATE operations:
   - To send a certificate: first use get_certificate_data with the learnerId to check if a certificate exists
   - If no certificate exists but learner is Competent, offer to generate_certificate first, then send_certificate
   - If learner is not Competent, inform the user that the learner needs to be marked Competent before a certificate can be issued
   - When user says "send certificate to [name]", look up the learner first, then check their enrollments
5. Be concise, professional, and proactive in suggesting next steps.
6. If you don't know something, say so honestly.
7. Format responses clearly — use bullet points for lists, bold for emphasis.

IMPORTANT: When you need to call a tool, output ONLY the JSON tool call on a single line. Do not wrap it in code blocks. After the tool result is provided, give your final answer to the user.`;

// Valid tool names for validation
const VALID_TOOLS = [
    // Read
    'search_course_runs', 'list_trainers', 'list_learners',
    'get_statistics', 'lookup_trainer_by_name', 'get_course_run_enrollments',
    'get_trainer_details', 'get_learner_details', 'get_certificate_data',
    // Write
    'assign_trainer', 'enroll_learner', 'remove_enrollment',
    'create_learner_account', 'update_learner_status', 'update_trainer_status',
    'create_course_run', 'delete_course_run', 'unassign_trainer',
    'generate_certificate', 'send_certificate',
];

// Tool execution functions
async function executeTool(name: string, input: any, req: NextApiRequest): Promise<string> {
    const baseUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

    switch (name) {
        // ==================== READ OPERATIONS ====================

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

        case 'get_course_run_enrollments': {
            const url = new URL('/api/admin/course-run-enrollments', baseUrl);
            url.searchParams.set('courseRunId', input.courseRunId);
            const res = await fetch(url.toString());
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'get_trainer_details': {
            const res = await fetch(new URL('/api/admin/trainers-detail', baseUrl).toString());
            const data = await res.json();
            return JSON.stringify(data.data || data, null, 2);
        }

        case 'get_learner_details': {
            const res = await fetch(new URL('/api/admin/learners-detail', baseUrl).toString());
            const data = await res.json();
            return JSON.stringify(data.data || data, null, 2);
        }

        case 'get_certificate_data': {
            const url = new URL('/api/admin/certificate-data', baseUrl);
            if (input.learnerId) url.searchParams.set('learnerId', input.learnerId);
            const res = await fetch(url.toString());
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        // ==================== WRITE OPERATIONS ====================

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

        case 'enroll_learner': {
            const res = await fetch(new URL('/api/admin/create-learner-account', baseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: input.email,
                    fullName: input.fullName,
                    courseRunId: input.courseRunId,
                    courseId: input.courseId || '',
                    sponsorshipType: input.sponsorshipType || 'Individual',
                }),
            });
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'remove_enrollment': {
            const res = await fetch(new URL('/api/admin/remove-enrollment', baseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: input.email,
                    courseRunId: input.courseRunId,
                }),
            });
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'create_learner_account': {
            const res = await fetch(new URL('/api/admin/create-learner-account', baseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: input.email,
                    fullName: input.fullName,
                    nric: input.nric || '',
                }),
            });
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'update_learner_status': {
            const res = await fetch(new URL('/api/admin/update-learner-status', baseUrl).toString(), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: input.userId,
                    newStatus: input.newStatus,
                }),
            });
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'update_trainer_status': {
            const res = await fetch(new URL('/api/admin/update-trainer-status', baseUrl).toString(), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: input.userId,
                    newStatus: input.newStatus,
                }),
            });
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'create_course_run': {
            const res = await fetch(new URL('/api/admin/add-course-run', baseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseCode: input.courseCode,
                    courseRunId: input.courseRunId,
                    startDate: input.startDate || '',
                    endDate: input.endDate || '',
                    classStatus: 'Confirmed',
                }),
            });
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'delete_course_run': {
            const res = await fetch(new URL('/api/admin/delete-course-run', baseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseRunId: input.courseRunId,
                }),
            });
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'unassign_trainer': {
            const res = await fetch(new URL('/api/admin/remove-trainer', baseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseRunUuid: input.courseRunUuid,
                }),
            });
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'generate_certificate': {
            const res = await fetch(new URL('/api/learner/generate-certificate', baseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enrolmentId: input.enrolmentId,
                }),
            });
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        case 'send_certificate': {
            const res = await fetch(new URL('/api/admin/send-certificate', baseUrl).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enrollmentId: input.enrollmentId,
                }),
            });
            const data = await res.json();
            return JSON.stringify(data, null, 2);
        }

        default:
            return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
}

// Call Claude CLI via stdin pipe and return the text response
function callClaude(fullPrompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const isWindows = process.platform === 'win32';
        const command = isWindows ? 'claude.cmd' : 'claude';

        const child = spawn(command, [
            '-p', '-',
            '--output-format', 'text',
            '--model', 'sonnet',
        ], {
            timeout: 60000,
            env: { ...process.env },
            shell: isWindows,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
        child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        child.on('close', (code: number | null) => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
            }
        });

        child.on('error', (err: Error) => reject(err));

        // Write prompt to stdin and close it
        child.stdin.write(fullPrompt);
        child.stdin.end();
    });
}

// Try to parse a tool call from Claude's response
function parseToolCall(text: string): { tool: string; params: any } | null {
    try {
        // Match JSON tool call pattern — supports nested params
        const jsonMatch = text.match(/\{"tool"\s*:\s*"(\w+)"\s*,\s*"params"\s*:\s*(\{[^}]*\})\s*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.tool && VALID_TOOLS.includes(parsed.tool)) {
                return parsed;
            }
        }
    } catch {
        // Not a tool call
    }
    return null;
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

        // Build conversation history
        const conversationHistory = messages
            .map((m: any) => {
                const role = m.role === 'model' ? 'Assistant' : m.role === 'user' ? 'User' : m.role;
                return `${role}: ${m.content || m.text}`;
            })
            .join('\n\n');

        const activeSystemPrompt = systemPrompt || NEMO_SYSTEM_PROMPT;

        // Agentic loop — handle tool calls
        let fullPrompt = `[SYSTEM INSTRUCTIONS]\n${activeSystemPrompt}\n[END SYSTEM INSTRUCTIONS]\n\n${conversationHistory}\n\nRespond as Nemo.`;
        let finalText = '';
        let iterations = 0;
        const maxIterations = 5;
        const toolHistory: { tool: string; params: any; result: string }[] = [];

        while (iterations < maxIterations) {
            iterations++;

            // Call Claude via CLI (uses your subscription)
            const responseText = await callClaude(fullPrompt);

            if (!responseText) {
                finalText = 'Sorry, I could not generate a response. Please try again.';
                break;
            }

            // Check if Claude wants to call a tool
            const toolCall = parseToolCall(responseText);
            if (toolCall) {
                console.log(`🔧 Nemo executing tool: ${toolCall.tool}`, toolCall.params);
                const toolResult = await executeTool(toolCall.tool, toolCall.params, req);
                toolHistory.push({ tool: toolCall.tool, params: toolCall.params, result: toolResult });

                // Build context with all tool results so far
                const toolContext = toolHistory
                    .map((t, i) => `Tool call ${i + 1}: ${t.tool}(${JSON.stringify(t.params)})\nResult: ${t.result}`)
                    .join('\n\n');

                // Continue conversation with tool results
                fullPrompt = `[SYSTEM INSTRUCTIONS]\n${activeSystemPrompt}\n[END SYSTEM INSTRUCTIONS]\n\n${conversationHistory}\n\n--- Tool Results ---\n${toolContext}\n\nBased on the tool results above, provide your response to the user. If you need another tool, output a tool call. Otherwise, give a clear answer.`;
            } else {
                // No tool call — this is the final response
                finalText = responseText;
                break;
            }
        }

        // Clean up any remaining artifacts
        const cleanedText = finalText
            .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
            .replace(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[^}]*\}\s*\}/g, '')
            .trim();

        return res.status(200).json({
            text: cleanedText,
            model: 'claude-cli',
            provider: 'claude-code',
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
