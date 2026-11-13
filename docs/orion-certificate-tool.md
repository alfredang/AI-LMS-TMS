# Orion certificate tool

Orion should expose one function tool named `send_learner_certificate`. Its
handler calls `POST /api/external/certificates/issue` with the LMS service key.
Merely adding this endpoint to Orion's prompt is insufficient: register the
function in the OpenAI agent's tool configuration or in the MCP server that
Orion uses for LMS operations.

For the current OpenClaw/WhatsApp deployment, agents do not automatically read
this repository file. Register the tool in Orion and send the procedure below
to Orion's group so it saves the behaviour.

```json
{
  "type": "function",
  "name": "send_learner_certificate",
  "description": "Find a learner's LMS enrollment, reuse or generate the issued certificate, store it in the LMS/Drive, and email the issued PDF. Use resend only when the user explicitly asks to send it again.",
  "parameters": {
    "type": "object",
    "properties": {
      "learner_email": { "type": "string" },
      "learner_name": { "type": "string", "description": "Exact learner name; add a course identifier to disambiguate" },
      "enrollment_id": { "type": "string" },
      "course_run_id": { "type": "string" },
      "course_code": { "type": "string" },
      "course_title": { "type": "string" },
      "course": { "type": "string", "description": "Course code or distinctive title text" },
      "send_email": { "type": "boolean", "default": true },
      "resend": { "type": "boolean", "default": false },
      "dry_run": { "type": "boolean", "default": false },
      "manual_override": { "type": "boolean", "default": false },
      "request_reason": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

Operational rules:

- Supply `learner_email` plus a course identifier whenever possible. If the
  request only gives a person, use the exact `learner_name`; ambiguity is handled
  safely by the endpoint.
- A `409 ambiguous_enrollment` response contains candidates; ask the user which
  course/run they mean instead of guessing.
- `already_sent` is success. Do not retry with `resend=true` unless requested.
- A direct instruction from an authorised operations user to "generate", "issue",
  or "send" the certificate is the approval to set `manual_override=true`.
  Copy that instruction into `request_reason` for the audit log.
- A cancelled class or enrollment is never overridable.
- Report `email_failed` accurately: the certificate may have been generated and
  stored even though delivery failed. If the error says the Gmail outcome is
  uncertain, check the learner mailbox and do not retry unless an authorised
  user explicitly asks; other definite failures can be retried normally.

## Message to send Orion

```text
@~Orion Please store this as your certificate procedure, replacing any current
procedure that searches Drive or asks for an undocumented certificate endpoint.
Confirm when saved.

SKILL: ISSUE AND SEND LMS CERTIFICATES

When an authorised operations user asks you to generate, issue, get, or send a
learner certificate, call:

POST /api/external/certificates/issue
x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
Content-Type: application/json

Use learner_email plus course/course_code/course_run_id whenever available. If
only the person's name is known, use learner_name with their exact name.
For the user's explicit issue/send instruction, send manual_override=true and
put a short faithful copy of their instruction in request_reason. Always leave
resend=false unless they explicitly ask to send the certificate again.

Example body:
{"learner_email":"kenny@example.com","course":"IoT","send_email":true,
"manual_override":true,"request_reason":"Alfred explicitly requested issue and delivery"}

The endpoint finds the LMS enrollment, reuses an existing issued certificate or
generates and stores it, and emails the same issued PDF. Do not search Drive and
do not use /api/admin/send-certificate-sg or /api/admin/send-certificate-gh.

If the response is ambiguous_enrollment, show the matching courses/runs and ask
which one. If it is already_sent, report success and do not resend. If it is
email_failed, say that issue/storage may have succeeded but email failed, and
report the returned error. If it says the delivery outcome is uncertain, do not
retry until the learner mailbox is checked. Never claim success unless status is sent or
already_sent. Cancelled classes/enrollments remain blocked.
```
