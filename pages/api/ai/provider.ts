import { CLAUDE_MODEL } from '@lib/ai/models';
import { runClaude } from '@lib/ai/claude';
import { startClaudeLogin, finishClaudeLogin } from '@lib/ai/claude-login';
import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import pool from '@lib/db';
import { aiSettings, generateOpenAi, saveOpenAiAuth, saveClaudeToken, getClaudeCredential } from '@lib/ai/settings';
import { validateModel } from '@lib/ai/credentials';
import { startLogin, loginStatus, cancelLogin } from '@lib/ai/login';

async function handler(req: AuthedApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      if (typeof req.query.loginId === 'string') return res.json({ success: true, login: loginStatus(req.query.loginId, req.authUser!.id) });
      const settings = await aiSettings();
      const claude = await pool.query(`SELECT 1 FROM training_provider_api WHERE training_provider_id = $1
        AND key_name = 'ANTHROPIC_API_KEY' AND key_value <> ''`, [settings.training_provider_id]);
      return res.json({ success: true, provider: settings.provider, model: settings.openai_model, claudeModel: CLAUDE_MODEL,
        openaiConnected: !!settings.oauth_encrypted, verifiedModel: settings.verified_model, claudeFallback: settings.claude_fallback,
        claudeConnected: !!settings.claude_encrypted || !!claude.rowCount || !!process.env.CLAUDE_CODE_OAUTH_TOKEN || !!process.env.ANTHROPIC_API_KEY });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
    const { action } = req.body || {};
    if (action === 'test-claude') {
      const token = await getClaudeCredential();
      if (!token) throw new Error('Enter a Claude OAuth token first.');
      if ((await runClaude(token, { prompt: 'Reply with exactly OK.' })).trim() !== 'OK') throw new Error('Claude test failed.');
      return res.json({ success: true, model: CLAUDE_MODEL, text: 'OK' });
    }
    if (action === 'claude-connect') return res.json({ success: true, claudeLogin: startClaudeLogin(req.authUser!.id) });
    if (action === 'claude-complete') {
      const token = await finishClaudeLogin(req.authUser!.id, String(req.body.state), String(req.body.code));
      await saveClaudeToken(token);
      return res.json({ success: true });
    }
    if (action === 'connect') return res.json({ success: true, login: await startLogin(req.authUser!.id) });
    if (action === 'cancel') {
      await cancelLogin(String(req.body.loginId), req.authUser!.id);
      return res.json({ success: true });
    }
    if (action === 'import') {
      if (typeof req.body.auth !== 'string') return res.status(400).json({ error: 'Paste the OpenAI OAuth auth.json contents or choose the file.' });
      await saveOpenAiAuth(req.body.auth);
      return res.json({ success: true });
    }
    if (action === 'claude-token') {
      const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
      if (!/^sk-ant-oat[^\s]{20,20000}$/.test(token)) return res.status(400).json({ error: 'Enter a Claude OAuth token beginning sk-ant-oat.' });
      await saveClaudeToken(token);
      return res.json({ success: true });
    }
    if (action === 'fallback') {
      if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'Choose whether to enable Claude fallback.' });
      if (req.body.enabled && !await getClaudeCredential()) throw new Error('Enter a Claude OAuth token before enabling fallback.');
      const settings = await aiSettings();
      await pool.query('UPDATE training_provider_ai SET claude_fallback = $2, updated_at = now() WHERE training_provider_id = $1', [settings.training_provider_id, req.body.enabled]);
      return res.json({ success: true });
    }
    if (action === 'test' || (action === 'select' && req.body.provider === 'openai')) {
      const model = validateModel(req.body.model);
      if (req.body.claudeFallback === true && !await getClaudeCredential()) throw new Error('Enter a Claude OAuth token before enabling fallback.');
      await generateOpenAi({ prompt: 'Reply with exactly OK.' }, model, action === 'select', req.body.claudeFallback === true);
      return res.json({ success: true, model, text: 'OK' });
    }
    if (action === 'select' && req.body.provider === 'claude') {
      const settings = await aiSettings();
      await pool.query("UPDATE training_provider_ai SET provider = 'claude', updated_at = now() WHERE training_provider_id = $1", [settings.training_provider_id]);
      return res.json({ success: true });
    }
    return res.status(400).json({ error: 'Unknown AI provider action' });
  } catch (error) {
    // Error messages from the integration contain no upstream token or prompt payloads.
    const message = error instanceof Error ? error.message : '';
    const safe = /^(OpenAI|Claude|Enter |Connect |Sign-in |An OpenAI|Configure AI_|Incomplete OAuth|Sign in with|OAuth credentials|Unexpected OpenAI|AI request)/.test(message);
    return res.status(400).json({ success: false, error: safe ? message : 'Unable to update the AI connection. Check the server configuration or reconnect OAuth.' });
  }
}
export const config = { api: { bodyParser: { sizeLimit: '80kb' } } };
export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
