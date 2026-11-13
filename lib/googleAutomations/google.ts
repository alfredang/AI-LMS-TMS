import { google } from 'googleapis';
import { AutomationError, assertScriptId, normalizeFiles, type ScriptFile } from './model';
import type { AutomationConfig } from './config';

export interface ScriptGateway {
  identity(): Promise<string>;
  list(): Promise<{ scriptId: string; name: string }[]>;
  metadata(scriptId: string): Promise<{ scriptId: string; name: string }>;
  read(scriptId: string): Promise<ScriptFile[]>;
  write(scriptId: string, files: ScriptFile[]): Promise<void>;
}
export function googleGateway(config: AutomationConfig): ScriptGateway {
  const { client_id, client_secret, refresh_token } = config.credentials;
  const auth = new google.auth.OAuth2(client_id, client_secret);
  auth.setCredentials({ refresh_token });
  const drive = google.drive({ version: 'v3', auth });
  const script = google.script({ version: 'v1', auth });
  const options = { timeout: 25000, retry: false };
  return {
    async identity() {
      const info = await drive.about.get({ fields: 'user(emailAddress)' }, options);
      const email = info.data.user?.emailAddress?.toLowerCase();
      if (!email || email !== config.accountEmail) throw new AutomationError(403, 'The Google account does not match this automation registry.');
      const token = await auth.getAccessToken();
      if (!token.token) throw new AutomationError(503, 'Google authorization needs reconnecting.');
      const scopes = await auth.getTokenInfo(token.token);
      if (!scopes.scopes.includes('https://www.googleapis.com/auth/script.projects')) throw new AutomationError(403, 'The connection needs the script.projects OAuth permission.');
      return email;
    },
    async list() {
      const found: { scriptId: string; name: string }[] = [];
      let pageToken: string | undefined;
      do {
        const response = await drive.files.list({ q: "mimeType='application/vnd.google-apps.script' and trashed=false", fields: 'nextPageToken,files(id,name)', pageSize: 100, pageToken }, options);
        for (const file of response.data.files || []) if (file.id) found.push({ scriptId: file.id, name: file.name || 'Untitled project' });
        pageToken = response.data.nextPageToken || undefined;
      } while (pageToken);
      return found;
    },
    async metadata(scriptId) {
      assertScriptId(scriptId);
      const result = await script.projects.get({ scriptId }, options);
      return { scriptId, name: result.data.title || 'Untitled project' };
    },
    async read(scriptId) {
      assertScriptId(scriptId);
      const result = await script.projects.getContent({ scriptId }, options);
      return normalizeFiles((result.data.files || []).map(f => ({ name: f.name, type: f.type, source: f.source || '' })));
    },
    async write(scriptId, files) {
      assertScriptId(scriptId);
      await script.projects.updateContent({ scriptId, requestBody: { files: normalizeFiles(files) } }, options);
    },
  };
}
