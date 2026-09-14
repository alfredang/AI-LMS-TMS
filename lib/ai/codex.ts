import type { UserInput } from '@openai/codex-sdk';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';
import { validateAuth, validateModel } from './credentials';

const DISABLED_FEATURES = ['shell_tool', 'unified_exec', 'multi_agent', 'multi_agent_v2', 'apps', 'plugins',
  'hooks', 'memories', 'skill_search', 'image_generation', 'view_image', 'browser_use',
  'browser_use_external', 'computer_use', 'code_mode', 'code_mode_host', 'tool_suggest'];
export function generationConfig(webSearch = false) {
  return { forced_login_method: 'chatgpt', cli_auth_credentials_store: 'file',
    web_search: webSearch ? 'live' : 'disabled', project_doc_max_bytes: 0,
    features: Object.fromEntries(DISABLED_FEATURES.map(feature => [feature, false])) };
}
function spawnClient(args: string[], dir: string) {
  return spawn(process.env.CODEX_BINARY || 'codex', args, {
    cwd: dir, env: { PATH: process.env.PATH, CODEX_HOME: dir, NODE_ENV: process.env.NODE_ENV }, stdio: ['pipe', 'pipe', 'pipe'],
  });
}
export interface AiImage { data: Buffer; extension: 'png' | 'jpg' | 'webp' | 'gif' }
export interface Generation { prompt: string; system?: string; images?: AiImage[]; webSearch?: boolean }

export async function runCodex(auth: string, model: string, input: Generation, onRefresh?: (auth: string) => Promise<void>): Promise<{ text: string; auth: string }> {
  if (input.prompt.length + (input.system?.length || 0) > 500000 || (input.images?.length || 0) > 12) {
    throw new Error('AI request is too large. Use fewer images or shorten the input.');
  }
  const dir = await mkdtemp(join(tmpdir(), 'lms-openai-'));
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 180000);
  try {
    await writeFile(join(dir, 'auth.json'), validateAuth(auth), { mode: 0o600 });
    const inputs: UserInput[] = [{ type: 'text', text: `${input.system || ''}\n\n${input.prompt}` }];
    for (const [i, image] of (input.images || []).entries()) {
      if (image.data.length > 20000000) throw new Error('Reference image exceeds 20 MB.');
      const path = join(dir, `image-${i}.${image.extension}`);
      await writeFile(path, image.data, { mode: 0o600 });
      inputs.push({ type: 'local_image', path });
    }
    const { Codex } = await import('@openai/codex-sdk');
    const codex = new Codex({
      codexPathOverride: process.env.CODEX_BINARY || (process.env.NODE_ENV === 'production' ? '/usr/local/bin/codex' : undefined),
      env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', CODEX_HOME: dir },
      config: generationConfig(input.webSearch),
    });
    const thread = codex.startThread({ model: validateModel(model), workingDirectory: dir,
      skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never',
      webSearchMode: input.webSearch ? 'live' : 'disabled' });
    let text = '', completed = false, size = 0;
    const { events } = await thread.runStreamed(inputs, { signal: abort.signal });
    for await (const event of events) {
      size += JSON.stringify(event).length;
      if (size > 4000000) { abort.abort(); throw new Error('OpenAI output exceeds the size limit.'); }
      if (event.type === 'turn.completed') completed = true;
      if (event.type === 'turn.failed' || event.type === 'error') throw new Error('OpenAI generation failed.');
      if (event.type === 'item.completed' && event.item.type === 'agent_message') text = event.item.text;
    }
    if (!completed || !text.trim()) throw new Error('OpenAI returned no completed response.');
    return { text: text.trim(), auth: validateAuth(await readFile(join(dir, 'auth.json'), 'utf8')) };
  } catch {
    // SDK stderr/errors may contain upstream payloads; expose a bounded diagnostic only.
    throw new Error(`OpenAI could not generate with model ${model}. Check the model ID, account access and OAuth connection on the AI Provider page.`);
  } finally {
    clearTimeout(timer);
    if (onRefresh) {
      try { await onRefresh(validateAuth(await readFile(join(dir, 'auth.json'), 'utf8'))); }
      catch { /* Keep the previous login if the SDK did not produce valid refreshed credentials. */ }
    }
    await rm(dir, { recursive: true, force: true });
  }
}

/** Local stdio only. Codex owns device authorization and token refresh. */
export class CodexLogin {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private proc: ChildProcessWithoutNullStreams;
  private constructor(readonly dir: string, onComplete: (success: boolean) => void) {
    this.proc = spawnClient(['app-server', '-c', 'cli_auth_credentials_store="file"'], dir);
    this.proc.stderr.resume();
    this.proc.stdin.on('error', () => {});
    createInterface({ input: this.proc.stdout }).on('line', line => {
      try {
        const msg = JSON.parse(line);
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id); clearTimeout(p.timer);
          if (msg.error) p.reject(new Error('OpenAI sign-in could not start. Enable device-code login in your ChatGPT security settings.'));
          else p.resolve(msg.result);
        }
        if (msg.method === 'account/login/completed') onComplete(msg.params.success === true);
      } catch { /* Ignore non-protocol output. */ }
    });
    const fail = () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('OpenAI sign-in client stopped. Please reconnect.')); }
      this.pending.clear();
    };
    this.proc.on('error', fail); this.proc.on('close', fail);
  }
  static async create(onComplete: (success: boolean) => void): Promise<CodexLogin> {
    const login = new CodexLogin(await mkdtemp(join(tmpdir(), 'lms-openai-login-')), onComplete);
    try {
      await login.rpc('initialize', { clientInfo: { name: 'tertiary_lms', title: 'Tertiary LMS/TMS', version: '1.0.0' } });
      login.proc.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
      return login;
    } catch (error) { await login.close(); throw error; }
  }
  rpc(method: string, params: object): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('OpenAI sign-in timed out. Please reconnect.')); }, 25000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async auth(): Promise<string> { return validateAuth(await readFile(join(this.dir, 'auth.json'), 'utf8')); }
  async close() {
    this.proc.kill('SIGKILL');
    await new Promise<void>(resolve => {
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) return resolve();
      this.proc.once('close', () => resolve());
      setTimeout(resolve, 1000).unref();
    });
    await rm(this.dir, { recursive: true, force: true });
  }
}
