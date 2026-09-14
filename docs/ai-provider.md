# AI OAuth providers

Administrators and Training Providers can open `/ai-provider`, also linked from
Company Settings → Credentials → LLM. The deployment uses its own training-provider
record; credentials and settings are isolated by that ID.

- Primary: OpenAI OAuth, `gpt-5.6-sol`, using `@openai/codex-sdk` 0.149.0.
- Fallback: Claude OAuth, `claude-opus-5`, using the Claude Agent SDK.
- Enable **Use Claude OAuth when OpenAI fails**, then save the fallback setting.
- **Test and use OpenAI OAuth** validates OpenAI itself before changing the primary.
  A fallback cannot make that test pass. Normal failed requests use Claude only
  when the administrator enabled fallback. Chat responses identify the provider
  actually used and include `usedFallback`.

The shared routing covers chat/draft content, CP generation, courseware documents,
assessment evidence and narratives, courseware audits, all three slide pipelines,
SEO generation and supporting-document analysis. Existing JSON parsing and output
builders are retained. Supporting PDFs are rendered for vision (up to 12 pages).
No email or publication is triggered by connecting or testing a provider.

## Connections

**OpenAI:** choose Connect OpenAI OAuth, open the verification link and enter the
one-time code. Enable device-code login in ChatGPT security settings if required.
Alternatively upload or paste a Codex ChatGPT `auth.json` containing access,
refresh and ID tokens plus account ID. An OpenAI Platform API key is not an OAuth
credential. Tokens stay on the server and Codex refreshes them during SDK use.

**Claude:** paste a `sk-ant-oat…` token, or choose Sign in to Claude again. Approve
the inference-only authorization, then paste the authorization code into this
page. This follows the installed Claude CLI's `setup-token` PKCE contract and
requests a one-year token. No token is returned to the browser.

The account login documentation is at
[OpenAI authentication](https://developers.openai.com/codex/auth) and
[Claude authentication](https://code.claude.com/docs/en/authentication).

## Operations

Set a private runtime-only `AI_OAUTH_ENCRYPTION_KEY` (at least 32 random characters)
and keep it stable across deployments/backups. A configured `JWT_SECRET` of at
least 32 characters is supported for existing installations. AES-256-GCM uses
separate per-provider associated data. The additive `training_provider_ai` table
is created idempotently on first use. General profile saves cannot delete it.

The Dockerfile installs pinned Codex 0.149.0 and Poppler. SDK generation runs in
private temporary sessions, with app credentials excluded from the OpenAI child
environment and agent tools disabled except explicitly requested research search.
OAuth refreshes and credential replacements are serialized with a PostgreSQL row
lock. Refreshed credentials are retained even when model generation fails.

`/api/ai/provider` is protected by the existing Admin/Training Provider role guard.
GET returns connection booleans and model/provider metadata only. POST actions:
`connect`, `cancel`, `import`, `claude-connect`, `claude-complete`, `claude-token`,
`test`, `test-claude`, `fallback`, `select`. Live login attempts are short-lived and
bound to the initiating user. Restarting the server cancels pending device login;
completed encrypted connections survive redeployment. A single application
replica is required for device-login polling (or sticky sessions if scaled).

## Verification

`node --import tsx --test tests/ai/provider.test.ts` uses synthetic credentials and
a fake CLI behind the real OpenAI SDK. It checks encrypted credential isolation,
model selection, denied tool access, success/failure and token refresh, device
login cleanup, image/PDF rendering and generator routing.

`tests/ai/api.integration.ts` exercises authentication, role denial, token import,
failed-switch preservation, SDK generation and provider metadata against an
isolated server on port 3003. It refuses non-local destinations. Set
`AI_TEST_BASE_URL` and `AI_TEST_DATABASE_URL` to that disposable fixture. Do not
run it against production or a server backed by the production database.
