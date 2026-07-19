/**
 * Message templates for the external-agent chat launcher.
 *
 * Each template is a fill-in-the-blank message the user sends to the external
 * agent (OpenClaw / Hermes) over WhatsApp or Telegram. Field names mirror the
 * parameters the agent's own tools and the /api/external/* endpoints expect, so
 * a completed template maps cleanly onto a real operation.
 *
 * Keep `body` plain text — it travels through a URL query parameter and is also
 * copied to the clipboard.
 */

export interface ChatTemplate {
    id: string;
    label: string;
    category: string;
    /** Extra words matched when searching, for terms not in the label. */
    keywords?: string;
    body: string;
}

/**
 * Trainer-facing requests.
 *
 * Deliberately narrow: trainers raise problems about their OWN classes and ask
 * for links. They must not touch schedules, course run IDs, enrolments, SSG
 * submissions, finance or anything else outside the trainer role — those stay
 * in the admin catalogue below, which the trainer widget never shows.
 *
 * Templates therefore identify a class by course title + date, never by an ID
 * the trainer would have to be given.
 */
export const TRAINER_TEMPLATES: ChatTemplate[] = [
    {
        id: 'trainer-cannot-find-class',
        label: 'Cannot find my class',
        category: 'My Classes',
        keywords: 'missing not showing cant see dashboard',
        body: `Cannot find my class
Trainer:
Course Title:
Start Date:
What I see instead:`,
    },
    {
        id: 'trainer-assign-me',
        label: 'Assign me to this class',
        category: 'My Classes',
        keywords: 'add trainer access not assigned',
        body: `Assign me to this class
Trainer:
Course Title:
Start Date:`,
    },
    {
        id: 'trainer-meeting-link',
        label: 'Send me the Google Meet link',
        category: 'Links',
        keywords: 'google meeting zoom virtual online join',
        body: `Send me the Google Meet link
Trainer:
Course Title:
Start Date:`,
    },
    {
        id: 'trainer-attendance-link',
        label: 'Send me the e-attendance link',
        category: 'Links',
        keywords: 'attendance eattendance qr code sign in digital',
        body: `Send me the e-attendance link
Trainer:
Course Title:
Start Date:`,
    },
];

/** Trainer starters — the list is short enough to show in full. */
export const TRAINER_STARTER_TEMPLATE_IDS = TRAINER_TEMPLATES.map(t => t.id);

/**
 * The handful shown before the user searches — one recognisable task from each
 * of the busiest areas. The full catalogue is a keystroke (or the "show all"
 * toggle) away.
 */
export const STARTER_TEMPLATE_IDS = [
    'add-trainer',
    'add-learner',
    'create-run',
    'add-session',
    'submit-run-ssg',
];

export const CHAT_TEMPLATE_CATEGORIES = [
    'Trainers',
    'Learners',
    'Classes',
    'Sessions',
    'SSG / TPGateway',
    'Finance',
    'Reports',
] as const;

export const CHAT_TEMPLATES: ChatTemplate[] = [
    // ── Trainers ────────────────────────────────────────────────────────────
    {
        id: 'add-trainer',
        label: 'Add trainer to a class',
        category: 'Trainers',
        keywords: 'assign trainer co-trainer second',
        body: `Add trainer to a class
Trainer:
Course Title:
Start Date:
Course Run ID:
Official trainer (yes/no):`,
    },
    {
        id: 'remove-trainer',
        label: 'Remove trainer from a class',
        category: 'Trainers',
        keywords: 'unassign delete drop',
        body: `Remove trainer from a class
Trainer:
Course Title:
Start Date:
Course Run ID:`,
    },
    {
        id: 'replace-trainer',
        label: 'Replace the trainer on a class',
        category: 'Trainers',
        keywords: 'swap change substitute',
        body: `Replace the trainer on a class
Current Trainer:
New Trainer:
Course Title:
Start Date:
Course Run ID:`,
    },
    {
        id: 'trainer-invite',
        label: 'Send trainer invitation',
        category: 'Trainers',
        keywords: 'invite email confirm availability',
        body: `Send trainer invitation
Trainer:
Course Title:
Start Date:
Course Run ID:`,
    },
    {
        id: 'sync-trainer-tpg',
        label: 'Sync trainer to TPGateway',
        category: 'Trainers',
        keywords: 'ssg tpg push official',
        body: `Sync trainer to TPGateway
Trainer:
Course Run ID:`,
    },
    {
        id: 'list-trainers',
        label: 'List trainers for a class',
        category: 'Trainers',
        keywords: 'who show assigned',
        body: `List trainers for a class
Course Title:
Start Date:
Course Run ID:`,
    },

    // ── Learners ────────────────────────────────────────────────────────────
    {
        id: 'add-learner',
        label: 'Add learner to a class',
        category: 'Learners',
        keywords: 'enrol enroll register student',
        body: `Add learner to a class
Learner Name:
Email:
NRIC / FIN:
Company:
Course Title:
Start Date:
Course Run ID:`,
    },
    {
        id: 'bulk-add-learners',
        label: 'Add multiple learners to a class',
        category: 'Learners',
        keywords: 'bulk batch enrol many',
        body: `Add multiple learners to a class
Course Title:
Start Date:
Course Run ID:
Learners (one per line — Name, Email, NRIC):
1.
2.
3.`,
    },
    {
        id: 'withdraw-learner',
        label: 'Withdraw learner from a class',
        category: 'Learners',
        keywords: 'cancel remove drop unenrol',
        body: `Withdraw learner from a class
Learner Name:
Course Title:
Start Date:
Course Run ID:
Reason:`,
    },
    {
        id: 'transfer-learner',
        label: 'Transfer learner to another run',
        category: 'Learners',
        keywords: 'move reschedule switch class',
        body: `Transfer learner to another run
Learner Name:
From Course Run ID:
To Course Run ID:
New Start Date:
Reason:`,
    },
    {
        id: 'learner-attendance',
        label: 'Check learner attendance',
        category: 'Learners',
        keywords: 'present absent mark record',
        body: `Check learner attendance
Learner Name:
Course Title:
Course Run ID:
Session Date:`,
    },
    {
        id: 'find-learner',
        label: 'Find a learner',
        category: 'Learners',
        keywords: 'search lookup enrolment history',
        body: `Find a learner
Name or Email or NRIC:`,
    },

    // ── Classes ─────────────────────────────────────────────────────────────
    {
        id: 'create-run',
        label: 'Create a new course run',
        category: 'Classes',
        keywords: 'new class open schedule add',
        body: `Create a new course run
Course Title:
Course Reference (TGS):
Start Date:
End Date:
Mode of Training (Classroom / Synchronous e-learning):
Trainer:
Venue:
Vacancy:`,
    },
    {
        id: 'cancel-run',
        label: 'Cancel a course run',
        category: 'Classes',
        keywords: 'delete scrap call off',
        body: `Cancel a course run
Course Title:
Start Date:
Course Run ID:
Reason:
Notify learners (yes/no):`,
    },
    {
        id: 'reschedule-run',
        label: 'Reschedule a course run',
        category: 'Classes',
        keywords: 'move postpone change dates',
        body: `Reschedule a course run
Course Title:
Course Run ID:
Current Start Date:
New Start Date:
New End Date:
Notify learners (yes/no):`,
    },
    {
        id: 'run-status',
        label: 'Check course run status',
        category: 'Classes',
        keywords: 'details confirm vacancy how many',
        body: `Check course run status
Course Title:
Start Date:
Course Run ID:`,
    },
    {
        id: 'confirm-run',
        label: 'Confirm a course run',
        category: 'Classes',
        keywords: 'status change confirmed proceed',
        body: `Confirm a course run
Course Title:
Start Date:
Course Run ID:`,
    },
    {
        id: 'upcoming-classes',
        label: 'List upcoming classes',
        category: 'Classes',
        keywords: 'this week next month schedule what',
        body: `List upcoming classes
From Date:
To Date:
Trainer (optional):`,
    },

    // ── Sessions ────────────────────────────────────────────────────────────
    {
        id: 'add-session',
        label: 'Add a course session',
        category: 'Sessions',
        keywords: 'new day extra lesson',
        body: `Add a course session
Course Title:
Course Run ID:
Session Date:
Start Time:
End Time:
Mode of Training:
Venue:`,
    },
    {
        id: 'cancel-session',
        label: 'Cancel a course session',
        category: 'Sessions',
        keywords: 'remove delete day off',
        body: `Cancel a course session
Course Title:
Course Run ID:
Session Date:
Session ID (if known):
Reason:`,
    },
    {
        id: 'reschedule-session',
        label: 'Reschedule a course session',
        category: 'Sessions',
        keywords: 'move change day time postpone',
        body: `Reschedule a course session
Course Title:
Course Run ID:
Current Session Date:
New Session Date:
New Start Time:
New End Time:`,
    },
    {
        id: 'list-sessions',
        label: 'List sessions for a class',
        category: 'Sessions',
        keywords: 'show days schedule timetable',
        body: `List sessions for a class
Course Title:
Course Run ID:`,
    },
    {
        id: 'session-calendar',
        label: 'Sync sessions to Google Calendar',
        category: 'Sessions',
        keywords: 'gcal invite event attendees',
        body: `Sync sessions to Google Calendar
Course Title:
Course Run ID:`,
    },

    // ── SSG / TPGateway ─────────────────────────────────────────────────────
    {
        id: 'submit-run-ssg',
        label: 'Submit course run to SSG',
        category: 'SSG / TPGateway',
        keywords: 'publish tpgateway upload register',
        body: `Submit course run to SSG
Course Title:
Course Reference (TGS):
Start Date:
End Date:
Course Run ID:`,
    },
    {
        id: 'cancel-run-ssg',
        label: 'Cancel course run on SSG',
        category: 'SSG / TPGateway',
        keywords: 'withdraw remove tpgateway delete',
        body: `Cancel course run on SSG
Course Title:
Course Run ID:
Reason:`,
    },
    {
        id: 'submit-enrolment-ssg',
        label: 'Submit enrolment to SSG',
        category: 'SSG / TPGateway',
        keywords: 'learner register grant tpgateway',
        body: `Submit enrolment to SSG
Learner Name:
NRIC / FIN:
Course Title:
Course Run ID:
Funding Scheme:`,
    },
    {
        id: 'submit-attendance-ssg',
        label: 'Submit attendance to SSG',
        category: 'SSG / TPGateway',
        keywords: 'upload mark present tpgateway',
        body: `Submit attendance to SSG
Course Title:
Course Run ID:
Session Date:`,
    },
    {
        id: 'submit-assessment-ssg',
        label: 'Submit assessment results to SSG',
        category: 'SSG / TPGateway',
        keywords: 'competent grade outcome tpgateway',
        body: `Submit assessment results to SSG
Course Title:
Course Run ID:
Assessment Date:
Learners and outcomes (C / NYC):`,
    },
    {
        id: 'check-course-validity',
        label: 'Check course validity on SSG',
        category: 'SSG / TPGateway',
        keywords: 'expiry approved valid period',
        body: `Check course validity on SSG
Course Title:
Course Reference (TGS):`,
    },
    {
        id: 'sync-ssg',
        label: 'Sync a course run with SSG',
        category: 'SSG / TPGateway',
        keywords: 'reconcile refresh pull compare',
        body: `Sync a course run with SSG
Course Title:
Course Run ID:`,
    },

    // ── Finance ─────────────────────────────────────────────────────────────
    {
        id: 'proforma-invoice',
        label: 'Generate proforma invoice',
        category: 'Finance',
        keywords: 'quote billing company pro-forma',
        body: `Generate proforma invoice
Company / Learner:
Course Title:
Start Date:
Course Run ID:
Number of Learners:`,
    },
    {
        id: 'invoice-status',
        label: 'Check invoice status',
        category: 'Finance',
        keywords: 'paid outstanding quickbooks payment',
        body: `Check invoice status
Invoice Number:
Company / Learner:`,
    },
    {
        id: 'grant-status',
        label: 'Check grant status',
        category: 'Finance',
        keywords: 'funding subsidy approved skillsfuture',
        body: `Check grant status
Learner Name:
NRIC / FIN:
Course Run ID:`,
    },
    {
        id: 'claim-status',
        label: 'Check claim status',
        category: 'Finance',
        keywords: 'disbursement reimbursement ssg payout',
        body: `Check claim status
Course Title:
Course Run ID:
Claim Period:`,
    },
    {
        id: 'submit-claim',
        label: 'Submit a claim to SSG',
        category: 'Finance',
        keywords: 'file lodge funding reimbursement',
        body: `Submit a claim to SSG
Course Title:
Course Run ID:
Claim Period:
Learners:`,
    },

    // ── Reports ─────────────────────────────────────────────────────────────
    {
        id: 'dashboard-summary',
        label: 'Dashboard summary',
        category: 'Reports',
        keywords: 'overview stats numbers today snapshot',
        body: `Dashboard summary
Period (e.g. this month):`,
    },
    {
        id: 'enrolment-report',
        label: 'Enrolment report',
        category: 'Reports',
        keywords: 'how many learners count signups',
        body: `Enrolment report
From Date:
To Date:
Course Title (optional):`,
    },
    {
        id: 'trainer-schedule',
        label: 'Trainer schedule',
        category: 'Reports',
        keywords: 'workload calendar assigned classes',
        body: `Trainer schedule
Trainer:
From Date:
To Date:`,
    },
    {
        id: 'attendance-report',
        label: 'Attendance report',
        category: 'Reports',
        keywords: 'present absent percentage summary',
        body: `Attendance report
Course Title:
Course Run ID:`,
    },
    {
        id: 'revenue-report',
        label: 'Revenue report',
        category: 'Reports',
        keywords: 'income sales money earned total',
        body: `Revenue report
From Date:
To Date:
Course Title (optional):`,
    },
];

/**
 * WhatsApp group-invite links (chat.whatsapp.com/<code>) open a join screen and
 * ignore ?text=. Only wa.me / api.whatsapp.com and Telegram deep links accept a
 * pre-filled body, so the picker falls back to clipboard-only for the rest.
 */
export function supportsPrefill(url: string): boolean {
    return /(?:wa\.me|api\.whatsapp\.com\/send|t\.me)/i.test(url) && !/chat\.whatsapp\.com/i.test(url);
}

/** Append the template body to the chat URL when the channel supports it. */
export function buildChatUrl(baseUrl: string, body: string): string {
    if (!supportsPrefill(baseUrl)) return baseUrl;
    const [path, query = ''] = baseUrl.split('?');
    const params = new URLSearchParams(query);
    params.set('text', body);
    return `${path}?${params.toString()}`;
}
