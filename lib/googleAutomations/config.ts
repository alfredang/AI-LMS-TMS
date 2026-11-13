import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AutomationError, type Project } from './model';
import type { TriggerSeed } from './triggerModel';

export type TriggerBridgeConfig = {url:string;secret:string;handlers:string[]};
export type TriggerManagementConfig = {reviewOnly?:boolean;allowApply?:boolean;inventory?:TriggerSeed[];bridges?:Record<string,TriggerBridgeConfig>};

export type AutomationConfig = {
  enabled: boolean; allowPublish: boolean; accountEmail: string; encryptionKey: string;
  credentials: { client_id: string; client_secret: string; refresh_token: string };
  projects: Pick<Project, 'scriptId' | 'name' | 'purpose' | 'category' | 'schedule' | 'dependencies'>[];
  triggerManagement?: TriggerManagementConfig;
};
export async function readConfig(): Promise<AutomationConfig | null> {
  if (process.env.GOOGLE_AUTOMATIONS_ENABLED === 'false') return null;
  const file = process.env.GOOGLE_AUTOMATIONS_CONFIG_FILE || path.join(process.cwd(), 'config', 'google-automations.private.json');
  let parsed: AutomationConfig|null;
  try {
    // Runtime-only deployment secret; useful when the hosting platform cannot
    // mount a private file. Never expose this through NEXT_PUBLIC_* or builds.
    parsed = JSON.parse(process.env.GOOGLE_AUTOMATIONS_CONFIG_B64
      ? Buffer.from(process.env.GOOGLE_AUTOMATIONS_CONFIG_B64,'base64').toString('utf8')
      : await fs.readFile(file, 'utf8'));
  }
  catch (error: any) {
    if(error.code==='ENOENT') {
      const [{loadStoredConnection},{default:pool}]=await Promise.all([import('./connectionStore'),import('../db')]);
      parsed=await loadStoredConnection(pool);
    } else throw new AutomationError(503, 'Google Automations configuration cannot be read. Contact your administrator.');
  }
  if (!parsed?.enabled) return null;
  if (!parsed.accountEmail || !/^[^\s@]+@[^\s@]+$/.test(parsed.accountEmail) || Buffer.from(parsed.encryptionKey || '', 'base64').length !== 32 || !parsed.credentials?.client_id || !parsed.credentials.client_secret || !parsed.credentials.refresh_token) throw new AutomationError(503, 'Google Automations requires a dedicated OAuth connection and a 32-byte backup encryption key.');
  return { ...parsed, accountEmail: parsed.accountEmail.toLowerCase(), allowPublish: parsed.allowPublish === true, projects: parsed.projects || [] };
}
export function connectionId(config: AutomationConfig) {
  return createHash('sha256').update(config.accountEmail).digest('hex');
}
