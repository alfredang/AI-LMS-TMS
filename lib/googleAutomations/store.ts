import type { Pool, PoolClient } from 'pg';
import { AutomationError, type Project } from './model';

// Kept in code for Next standalone deployments (which do not ship migration SQL).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS google_automation_project (
 connection_id TEXT NOT NULL, script_id TEXT NOT NULL, name TEXT NOT NULL,
 purpose TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Unclassified',
 schedule TEXT NOT NULL DEFAULT 'Not verified', dependencies TEXT NOT NULL DEFAULT '',
 refreshed_at TIMESTAMPTZ, source_hash TEXT, source_ciphertext TEXT,
 access_status TEXT NOT NULL DEFAULT 'Not checked', PRIMARY KEY(connection_id,script_id));
CREATE TABLE IF NOT EXISTS google_automation_draft (
 id UUID PRIMARY KEY, connection_id TEXT NOT NULL, script_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, reason TEXT NOT NULL, base_hash TEXT NOT NULL, target_hash TEXT NOT NULL,
 source_ciphertext TEXT NOT NULL, changed_files JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 attempted_at TIMESTAMPTZ, applied_at TIMESTAMPTZ, published_by TEXT,
 FOREIGN KEY(connection_id,script_id) REFERENCES google_automation_project(connection_id,script_id));
CREATE INDEX IF NOT EXISTS google_automation_draft_project_idx ON google_automation_draft(connection_id,script_id,created_at DESC);`;

export type Draft = { id: string; script_id: string; actor_id: string; reason: string; base_hash: string; target_hash: string; source_ciphertext: string; changed_files: string[]; status: string; created_at: string; applied_at: string | null; published_by: string | null };
export interface AutomationStore {
  init(): Promise<void>;
  projects(): Promise<Project[]>;
  register(project: Partial<Project> & Pick<Project, 'scriptId' | 'name'>): Promise<void>;
  project(id: string): Promise<Project & { source_ciphertext: string | null }>;
  metadata(id: string, values: Pick<Project, 'purpose' | 'category' | 'schedule' | 'dependencies'>): Promise<void>;
  snapshot(id: string, hash: string, ciphertext: string): Promise<void>;
  saveDraft(draft: Pick<Draft, 'id' | 'script_id' | 'actor_id' | 'reason' | 'base_hash' | 'target_hash' | 'source_ciphertext' | 'changed_files'>): Promise<void>;
  draft(id: string, scriptId: string): Promise<Draft>;
  history(scriptId: string): Promise<Omit<Draft, 'source_ciphertext'>[]>;
  status(id: string, state: string, actor: string): Promise<void>;
  locked<T>(id: string, fn: (store: AutomationStore) => Promise<T>): Promise<T>;
}
export class PgAutomationStore implements AutomationStore {
  constructor(private pool: Pool, private connection: string, private client?: PoolClient) {}
  private query(sql: string, values?: unknown[]) { return (this.client || this.pool).query(sql, values); }
  async init() {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('google-automation-schema-v1'))");
      await client.query(SCHEMA);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('google-automation-schema-v1'))").catch(() => {});
      client.release();
    }
  }
  async projects() {
    return (await this.query(`SELECT script_id AS "scriptId",name,purpose,category,schedule,dependencies,refreshed_at AS "refreshedAt",source_hash AS "sourceHash",access_status AS "accessStatus" FROM google_automation_project WHERE connection_id=$1 ORDER BY name,script_id`, [this.connection])).rows;
  }
  async register(p: Partial<Project> & Pick<Project, 'scriptId' | 'name'>) {
    await this.query(`INSERT INTO google_automation_project(connection_id,script_id,name,purpose,category,schedule,dependencies) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(connection_id,script_id) DO NOTHING`, [this.connection,p.scriptId,p.name,p.purpose || '',p.category || 'Unclassified',p.schedule || 'Not verified',p.dependencies || '']);
  }
  async project(id: string) {
    const row = (await this.query(`SELECT script_id AS "scriptId",name,purpose,category,schedule,dependencies,refreshed_at AS "refreshedAt",source_hash AS "sourceHash",access_status AS "accessStatus",source_ciphertext FROM google_automation_project WHERE connection_id=$1 AND script_id=$2`, [this.connection,id])).rows[0];
    if (!row) throw new AutomationError(404, 'This script is not registered with this connection.');
    return row;
  }
  async metadata(id: string, p: Pick<Project, 'purpose' | 'category' | 'schedule' | 'dependencies'>) {
    await this.query(`UPDATE google_automation_project SET purpose=$3,category=$4,schedule=$5,dependencies=$6 WHERE connection_id=$1 AND script_id=$2`, [this.connection,id,p.purpose,p.category,p.schedule,p.dependencies]);
  }
  async snapshot(id: string, hash: string, ciphertext: string) {
    await this.query(`UPDATE google_automation_project SET source_hash=$3,source_ciphertext=$4,refreshed_at=now(),access_status='Readable' WHERE connection_id=$1 AND script_id=$2`, [this.connection,id,hash,ciphertext]);
  }
  async saveDraft(d: Pick<Draft, 'id' | 'script_id' | 'actor_id' | 'reason' | 'base_hash' | 'target_hash' | 'source_ciphertext' | 'changed_files'>) {
    await this.query(`INSERT INTO google_automation_draft(id,connection_id,script_id,actor_id,reason,base_hash,target_hash,source_ciphertext,changed_files) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [d.id,this.connection,d.script_id,d.actor_id,d.reason,d.base_hash,d.target_hash,d.source_ciphertext,JSON.stringify(d.changed_files)]);
  }
  async draft(id: string, scriptId: string) {
    const row = (await this.query(`SELECT * FROM google_automation_draft WHERE connection_id=$1 AND script_id=$2 AND id=$3`, [this.connection,scriptId,id])).rows[0];
    if (!row) throw new AutomationError(404, 'Draft or backup not found.');
    return row;
  }
  async history(scriptId: string) {
    return (await this.query(`SELECT id,script_id,actor_id,reason,base_hash,target_hash,changed_files,status,created_at,applied_at,published_by FROM google_automation_draft WHERE connection_id=$1 AND script_id=$2 ORDER BY created_at DESC LIMIT 100`, [this.connection,scriptId])).rows;
  }
  async status(id: string, state: string, actor: string) {
    await this.query(`UPDATE google_automation_draft SET status=$3,published_by=$4,attempted_at=COALESCE(attempted_at,now()),applied_at=CASE WHEN $3='applied' THEN now() ELSE applied_at END WHERE connection_id=$1 AND id=$2`, [this.connection,id,state,actor]);
  }
  async locked<T>(id: string, fn: (store: AutomationStore) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const key = `google-automation:${this.connection}:${id}`;
    try {
      const lock = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [key]);
      if (!lock.rows[0].acquired) throw new AutomationError(409, 'Another source update is in progress. Try again after it finishes.');
      return await fn(new PgAutomationStore(this.pool,this.connection,client));
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]).catch(() => {});
      client.release();
    }
  }
}
