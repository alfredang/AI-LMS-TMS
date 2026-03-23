import React, { useState } from 'react';
import { Icon, IconName } from '../ui/Icon';

interface EndpointDoc {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  title: string;
  description: string;
  headers: { name: string; value: string; description: string }[];
  queryParams?: { name: string; type: string; required: boolean; description: string }[];
  bodyFields?: { name: string; type: string; required: boolean; description: string }[];
  exampleRequest: string;
  exampleResponse: string;
}

const endpoints: EndpointDoc[] = [
  {
    method: 'POST',
    path: '/api/external/assign-trainer',
    title: 'Assign Trainer to Course Run',
    description: 'Assigns a trainer to a course run. Creates the course run if it does not exist, or updates it if the digital attendance ID is not yet set.',
    headers: [
      { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
      { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
    ],
    bodyFields: [
      { name: 'course_run_id', type: 'string', required: true, description: 'The SSG course run ID (e.g. "1303232")' },
      { name: 'primary_email', type: 'string', required: true, description: 'Trainer primary email address' },
      { name: 'course_code', type: 'string', required: true, description: 'Course code (e.g. "TGS-2023011234")' },
      { name: 'secondary_email', type: 'string', required: false, description: 'Trainer secondary email (empty string if none)' },
      { name: 'course_title', type: 'string', required: false, description: 'Course title (used to derive mode of learning)' },
      { name: 'start_date', type: 'string', required: false, description: 'Start date (formats: "12 Mar 2026", "2026-03-12", or 20260312)' },
      { name: 'end_date', type: 'string', required: false, description: 'End date (same formats as start_date)' },
      { name: 'ra_code', type: 'string', required: false, description: 'Digital attendance RA code (e.g. "RA741642")' },
    ],
    exampleRequest: `curl -X POST https://ai-lms-tms.tertiaryinfo.tech/api/external/assign-trainer \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "course_run_id": "1303232",
    "primary_email": "trainer@example.com",
    "course_code": "TGS-2023011234",
    "course_title": "Virtual Training Course",
    "start_date": "12 Mar 2026",
    "end_date": "14 Mar 2026",
    "ra_code": "RA741642"
  }'`,
    exampleResponse: `{
  "success": true,
  "message": "Trainer assigned successfully (course run created)",
  "action": "created",
  "data": {
    "courseRunId": "1303232",
    "courseCode": "TGS-2023011234",
    "courseTitle": "Virtual Training Course",
    "startDate": "2026-03-12",
    "endDate": "2026-03-14",
    "raCode": "RA741642",
    "trainerId": "uuid-...",
    "trainerName": "John Doe",
    "trainerEmail": "trainer@example.com"
  }
}`,
  },
  {
    method: 'POST',
    path: '/api/external/unassign-trainer',
    title: 'Unassign Trainer from Course Run',
    description: 'Removes the assigned trainer from a course run by clearing the trainer fields.',
    headers: [
      { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
      { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
    ],
    bodyFields: [
      { name: 'course_run_id', type: 'string', required: true, description: 'The SSG course run ID' },
    ],
    exampleRequest: `curl -X POST https://ai-lms-tms.tertiaryinfo.tech/api/external/unassign-trainer \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "course_run_id": "1303232" }'`,
    exampleResponse: `{
  "success": true,
  "message": "Trainer unassigned from course run 1303232"
}`,
  },
  {
    method: 'GET',
    path: '/api/external/get-course-run',
    title: 'Get Course Run Details',
    description: 'Retrieves full details for a specific course run, including assigned trainer and enrolled learner count.',
    headers: [
      { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
    ],
    queryParams: [
      { name: 'course_run_id', type: 'string', required: true, description: 'The SSG course run ID' },
    ],
    exampleRequest: `curl -X GET "https://ai-lms-tms.tertiaryinfo.tech/api/external/get-course-run?course_run_id=1303232" \\
  -H "x-api-key: YOUR_API_KEY"`,
    exampleResponse: `{
  "success": true,
  "data": {
    "uuid": "...",
    "course_run_id": "1303232",
    "start_date": "2026-03-12",
    "end_date": "2026-03-14",
    "class_status": "Confirmed",
    "mode_of_learning": "Virtual",
    "digital_attendance_id": "RA741642",
    "assigned_trainer_id": "...",
    "assigned_trainer_name": "John Doe",
    "assigned_trainer_email": "trainer@example.com",
    "course_title": "Virtual Training Course",
    "course_code": "TGS-2023011234",
    "enrolled_learners": "12"
  }
}`,
  },
  {
    method: 'GET',
    path: '/api/external/list-course-runs',
    title: 'List Course Runs',
    description: 'Lists course runs with optional filtering by status and trainer email. Returns up to 200 results ordered by start date descending.',
    headers: [
      { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
    ],
    queryParams: [
      { name: 'status', type: 'string', required: false, description: 'Filter by class status (e.g. "Confirmed", "Completed")' },
      { name: 'trainer_email', type: 'string', required: false, description: 'Filter by assigned trainer email (case-insensitive)' },
    ],
    exampleRequest: `curl -X GET "https://ai-lms-tms.tertiaryinfo.tech/api/external/list-course-runs?status=Confirmed" \\
  -H "x-api-key: YOUR_API_KEY"`,
    exampleResponse: `{
  "success": true,
  "count": 5,
  "data": [
    {
      "uuid": "...",
      "course_run_id": "1303232",
      "start_date": "2026-03-12",
      "end_date": "2026-03-14",
      "class_status": "Confirmed",
      "mode_of_learning": "Virtual",
      "digital_attendance_id": "RA741642",
      "assigned_trainer_name": "John Doe",
      "assigned_trainer_email": "trainer@example.com",
      "course_title": "Virtual Training Course",
      "course_code": "TGS-2023011234"
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/external/list-trainers',
    title: 'List Trainers',
    description: 'Lists all trainers with their profile information. Optionally filter by trainer status.',
    headers: [
      { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
    ],
    queryParams: [
      { name: 'status', type: 'string', required: false, description: 'Filter by trainer status (e.g. "Active")' },
    ],
    exampleRequest: `curl -X GET "https://ai-lms-tms.tertiaryinfo.tech/api/external/list-trainers?status=Active" \\
  -H "x-api-key: YOUR_API_KEY"`,
    exampleResponse: `{
  "success": true,
  "count": 3,
  "data": [
    {
      "user_id": "...",
      "full_name": "John Doe",
      "email": "trainer@example.com",
      "secondary_email": null,
      "trainer_type": "Internal",
      "trainer_status": "Active",
      "account_status": "active"
    }
  ]
}`,
  },
];

const methodColors: Record<string, string> = {
  GET: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  POST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  PUT: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const ApiEndpointsView: React.FC = () => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API Endpoints</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          External API endpoints for automating trainer assignment and course run management.
        </p>
      </div>

      {/* Authentication Info */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
        <div className="flex items-start gap-3">
          <Icon name={IconName.Admin} className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-blue-800 dark:text-blue-300">Authentication</h3>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
              All endpoints require an <code className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-800 text-xs font-mono">x-api-key</code> header.
              Contact your system administrator to obtain the API key.
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
              Base URL: <code className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-800 text-xs font-mono">https://ai-lms-tms.tertiaryinfo.tech</code>
            </p>
          </div>
        </div>
      </div>

      {/* Endpoints */}
      <div className="space-y-3">
        {endpoints.map((ep, idx) => (
          <div key={idx} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 overflow-hidden">
            {/* Endpoint Header */}
            <button
              onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
            >
              <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${methodColors[ep.method]}`}>
                {ep.method}
              </span>
              <code className="text-sm font-mono text-gray-700 dark:text-gray-300 flex-1">{ep.path}</code>
              <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">{ep.title}</span>
              <Icon
                name={IconName.ChevronDown}
                className={`w-4 h-4 text-gray-400 transition-transform ${expandedIndex === idx ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Expanded Detail */}
            {expandedIndex === idx && (
              <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-300">{ep.description}</p>

                {/* Headers */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Headers</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                          <th className="pb-1 pr-4">Name</th>
                          <th className="pb-1 pr-4">Value</th>
                          <th className="pb-1">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ep.headers.map((h, i) => (
                          <tr key={i} className="border-b dark:border-gray-700/50 last:border-0">
                            <td className="py-1.5 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{h.name}</td>
                            <td className="py-1.5 pr-4 font-mono text-xs text-gray-500 dark:text-gray-400">{h.value}</td>
                            <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{h.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Query Parameters */}
                {ep.queryParams && ep.queryParams.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Query Parameters</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                            <th className="pb-1 pr-4">Name</th>
                            <th className="pb-1 pr-4">Type</th>
                            <th className="pb-1 pr-4">Required</th>
                            <th className="pb-1">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ep.queryParams.map((p, i) => (
                            <tr key={i} className="border-b dark:border-gray-700/50 last:border-0">
                              <td className="py-1.5 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{p.name}</td>
                              <td className="py-1.5 pr-4 text-xs text-gray-500 dark:text-gray-400">{p.type}</td>
                              <td className="py-1.5 pr-4">
                                {p.required
                                  ? <span className="text-xs text-red-600 dark:text-red-400 font-medium">Yes</span>
                                  : <span className="text-xs text-gray-400">No</span>
                                }
                              </td>
                              <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{p.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Body Fields */}
                {ep.bodyFields && ep.bodyFields.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Request Body (JSON)</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                            <th className="pb-1 pr-4">Field</th>
                            <th className="pb-1 pr-4">Type</th>
                            <th className="pb-1 pr-4">Required</th>
                            <th className="pb-1">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ep.bodyFields.map((f, i) => (
                            <tr key={i} className="border-b dark:border-gray-700/50 last:border-0">
                              <td className="py-1.5 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{f.name}</td>
                              <td className="py-1.5 pr-4 text-xs text-gray-500 dark:text-gray-400">{f.type}</td>
                              <td className="py-1.5 pr-4">
                                {f.required
                                  ? <span className="text-xs text-red-600 dark:text-red-400 font-medium">Yes</span>
                                  : <span className="text-xs text-gray-400">No</span>
                                }
                              </td>
                              <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{f.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Example Request */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Example Request</h4>
                    <button
                      onClick={() => copyToClipboard(ep.exampleRequest, idx)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                      {copiedIndex === idx ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <pre className="bg-gray-900 text-gray-100 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                    {ep.exampleRequest}
                  </pre>
                </div>

                {/* Example Response */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Example Response</h4>
                  <pre className="bg-gray-900 text-gray-100 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                    {ep.exampleResponse}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Error Codes */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 p-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Error Codes</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Description</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">200</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Success</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400">400</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Bad request - Missing required fields or invalid data</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">401</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Unauthorized - Invalid or missing API key</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">404</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Not found - Resource does not exist</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400">405</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Method not allowed - Wrong HTTP method</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">500</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Internal server error</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ApiEndpointsView;
