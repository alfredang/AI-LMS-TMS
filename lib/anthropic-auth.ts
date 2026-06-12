/**
 * Build the env record for the Claude Agent SDK subprocess.
 *
 * Subscription / OAuth tokens (prefixed `sk-ant-oat`) authenticate via
 * `CLAUDE_CODE_OAUTH_TOKEN` — the same env var Claude Code CLI reads
 * when `~/.claude/.credentials.json` isn't available (e.g. in Docker).
 * Standard API keys use `ANTHROPIC_API_KEY`.
 *
 * We also strip the other auth env vars so a stale value leaked in
 * from `process.env` (e.g. a Coolify-set `ANTHROPIC_API_KEY`) doesn't
 * shadow the token we actually want to use.
 */
export function buildClaudeEnv(token: string): Record<string, string | undefined> {
  const trimmed = token.trim();
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  if (trimmed.startsWith('sk-ant-oat')) {
    env.CLAUDE_CODE_OAUTH_TOKEN = trimmed;
  } else {
    env.ANTHROPIC_API_KEY = trimmed;
  }
  return env;
}
