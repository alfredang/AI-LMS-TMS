import React, { useState, useEffect, useCallback } from 'react';
import { Icon, IconName } from '../ui/Icon';

interface Webhook {
  id: string;
  name: string;
  description: string | null;
  http_method: string;
  endpoint_token: string;
  auth_token: string | null;
  enabled: boolean;
  created_at: string;
  last_called: string | null;
  call_count: number;
}

interface WebhookLog {
  id: number;
  webhook_id: string;
  received_at: string;
  http_method: string;
  headers: any;
  query_params: any;
  body: any;
  source_ip: string;
  status_code: number;
  error_message: string | null;
}

type ViewMode = 'list' | 'form' | 'logs';

export default function WebhooksView() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [copied, setCopied] = useState('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formMethod, setFormMethod] = useState('POST');
  const [formAuthToken, setFormAuthToken] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/training-provider/webhooks');
      const json = await resp.json();
      if (json.success) setWebhooks(json.webhooks);
    } catch { }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const fetchLogs = async (webhookId: string) => {
    setLogsLoading(true);
    try {
      const resp = await fetch(`/api/training-provider/webhook-logs?webhookId=${webhookId}&limit=50`);
      const json = await resp.json();
      if (json.success) { setLogs(json.logs); setLogsTotal(json.total); }
    } catch { }
    finally { setLogsLoading(false); }
  };

  const handleCreate = () => {
    setEditingWebhook(null);
    setFormName(''); setFormDesc(''); setFormMethod('POST'); setFormAuthToken(''); setFormError('');
    setViewMode('form');
  };

  const handleEdit = (w: Webhook) => {
    setEditingWebhook(w);
    setFormName(w.name); setFormDesc(w.description || ''); setFormMethod(w.http_method); setFormAuthToken(w.auth_token || ''); setFormError('');
    setViewMode('form');
  };

  const handleSave = async () => {
    if (!formName.trim()) { setFormError('Name is required'); return; }
    setSaving(true); setFormError('');
    try {
      const body = editingWebhook
        ? { id: editingWebhook.id, name: formName, description: formDesc, http_method: formMethod, auth_token: formAuthToken || null }
        : { name: formName, description: formDesc, http_method: formMethod, auth_token: formAuthToken || null };
      const resp = await fetch('/api/training-provider/webhooks', {
        method: editingWebhook ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!json.success) { setFormError(json.error || 'Failed to save'); return; }
      await fetchWebhooks();
      setViewMode('list');
    } catch (err) { setFormError(err instanceof Error ? err.message : 'Network error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this webhook? All logs will be removed.')) return;
    await fetch('/api/training-provider/webhooks', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    fetchWebhooks();
  };

  const handleToggle = async (w: Webhook) => {
    await fetch('/api/training-provider/webhooks', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: w.id, enabled: !w.enabled }),
    });
    fetchWebhooks();
  };

  const handleViewLogs = (w: Webhook) => {
    setSelectedWebhook(w);
    setExpandedLog(null);
    fetchLogs(w.id);
    setViewMode('logs');
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const getEndpointUrl = (token: string) => `${baseUrl}/api/webhooks/${token}`;

  // --- FORM VIEW ---
  if (viewMode === 'form') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setViewMode('list')} className="text-gray-400 hover:text-on-surface transition-colors">
            <Icon name={IconName.Back} className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-on-surface">{editingWebhook ? 'Edit Webhook' : 'Create Webhook'}</h1>
        </div>

        <div className="max-w-xl space-y-4">
          <div>
            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Name *</label>
            <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Course Completion Trigger"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Description</label>
            <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2} placeholder="Optional description"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-on-surface-secondary mb-1">HTTP Method</label>
            <select value={formMethod} onChange={e => setFormMethod(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary">
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Auth Token (optional)</label>
            <input value={formAuthToken} onChange={e => setFormAuthToken(e.target.value)} placeholder="Bearer token for callers"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-on-surface px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary" />
            <p className="text-xs text-on-surface-secondary mt-1">If set, callers must include <code>Authorization: Bearer &lt;token&gt;</code></p>
          </div>

          {editingWebhook && (
            <div>
              <label className="block text-sm font-medium text-on-surface-secondary mb-1">Endpoint URL</label>
              <div className="flex items-center gap-2">
                <input value={getEndpointUrl(editingWebhook.endpoint_token)} readOnly
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-slate-800 text-on-surface px-3 py-2 text-sm font-mono" />
                <button onClick={() => copyToClipboard(getEndpointUrl(editingWebhook.endpoint_token), 'url')}
                  className="px-3 py-2 rounded-lg bg-gray-200 dark:bg-slate-600 text-sm hover:bg-gray-300 dark:hover:bg-slate-500 transition-colors">
                  {copied === 'url' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {formError && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">{formError}</div>}

          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Saving…' : editingWebhook ? 'Update' : 'Create'}
            </button>
            <button onClick={() => setViewMode('list')} className="px-6 py-2.5 rounded-lg bg-gray-200 dark:bg-slate-600 text-on-surface font-medium text-sm hover:bg-gray-300 dark:hover:bg-slate-500">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- LOGS VIEW ---
  if (viewMode === 'logs' && selectedWebhook) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setViewMode('list')} className="text-gray-400 hover:text-on-surface transition-colors">
            <Icon name={IconName.Back} className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-on-surface">Webhook Logs</h1>
            <p className="text-sm text-on-surface-secondary">{selectedWebhook.name} · {logsTotal} total calls</p>
          </div>
        </div>

        {logsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : logs.length === 0 ? (
          <p className="text-on-surface-secondary py-8 text-center">No calls received yet.</p>
        ) : (
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex items-center gap-3 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${log.status_code === 200 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'}`}>
                      {log.status_code}
                    </span>
                    <span className="font-mono text-xs text-on-surface-secondary">{log.http_method}</span>
                    <span className="text-on-surface-secondary">{log.source_ip || '—'}</span>
                    <span className="text-on-surface-secondary">{new Date(log.received_at).toLocaleString()}</span>
                    {log.error_message && <span className="text-red-500 text-xs">{log.error_message}</span>}
                  </div>
                  <Icon name={IconName.ChevronDown} className={`w-4 h-4 text-gray-400 transition-transform ${expandedLog === log.id ? 'rotate-180' : ''}`} />
                </button>
                {expandedLog === log.id && (
                  <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900 space-y-3">
                    {log.query_params && Object.keys(log.query_params).length > 1 && (
                      <div>
                        <p className="text-xs font-semibold text-on-surface-secondary uppercase mb-1">Query Params</p>
                        <pre className="text-xs font-mono text-on-surface overflow-x-auto">{JSON.stringify(log.query_params, null, 2)}</pre>
                      </div>
                    )}
                    {log.body && (
                      <div>
                        <p className="text-xs font-semibold text-on-surface-secondary uppercase mb-1">Body</p>
                        <pre className="text-xs font-mono text-on-surface overflow-x-auto max-h-48">{JSON.stringify(log.body, null, 2)}</pre>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-on-surface-secondary uppercase mb-1">Headers</p>
                      <pre className="text-xs font-mono text-on-surface overflow-x-auto max-h-32">{JSON.stringify(log.headers, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- LIST VIEW ---
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-on-surface">Webhooks</h1>
        <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 flex items-center gap-2">
          <Icon name={IconName.Add} className="w-4 h-4" /> Create Webhook
        </button>
      </div>

      {/* Built-in Webhooks */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-on-surface">Built-in Webhooks</h2>
        <p className="text-sm text-on-surface-secondary">System webhooks for trainer invitation accept/decline. These are automatically triggered when trainers click the links in invitation emails.</p>
        <div className="space-y-3">
          {[
            {
              name: 'Trainer Invitation — Accept',
              method: 'GET',
              description: 'When a trainer clicks "Accept" in the invitation email, this webhook assigns the trainer to the class and sends a confirmation email.',
              url: `${baseUrl}/api/public/trainer-invitation/respond?token={TOKEN}&action=accept`,
            },
            {
              name: 'Trainer Invitation — Decline',
              method: 'GET',
              description: 'When a trainer clicks "Decline", this webhook sends a decline acknowledgement email and auto-sends an invitation to the next available trainer.',
              url: `${baseUrl}/api/public/trainer-invitation/respond?token={TOKEN}&action=decline`,
            },
          ].map((w, i) => (
            <div key={i} className="border border-green-200 dark:border-green-800 rounded-lg p-4 bg-green-50/50 dark:bg-green-900/10">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-on-surface">{w.name}</h3>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">{w.method}</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Active</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Built-in</span>
              </div>
              <p className="text-sm text-on-surface-secondary mb-2">{w.description}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-on-surface-secondary bg-white dark:bg-slate-800 px-3 py-1.5 rounded truncate border border-gray-200 dark:border-gray-700">
                  {w.url}
                </code>
                <button
                  onClick={() => copyToClipboard(w.url, `builtin-${i}`)}
                  className="px-2.5 py-1.5 rounded text-xs font-medium bg-gray-200 dark:bg-slate-600 hover:bg-gray-300 dark:hover:bg-slate-500 transition-colors whitespace-nowrap"
                >
                  {copied === `builtin-${i}` ? 'Copied!' : 'Copy URL'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <hr className="border-gray-200 dark:border-gray-700" />

      {/* Custom Webhooks */}
      <h2 className="text-lg font-semibold text-on-surface">Custom Webhooks</h2>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-16">
          <Icon name={IconName.Link} className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-on-surface-secondary mb-4">No webhooks created yet</p>
          <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium">Create your first webhook</button>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map(w => (
            <div key={w.id} className={`border rounded-lg p-4 transition-colors ${w.enabled ? 'border-gray-200 dark:border-gray-700' : 'border-gray-200 dark:border-gray-700 opacity-60'}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-on-surface">{w.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${w.http_method === 'GET' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                      {w.http_method}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${w.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                      {w.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  {w.description && <p className="text-sm text-on-surface-secondary mt-1">{w.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleToggle(w)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" title={w.enabled ? 'Disable' : 'Enable'}>
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${w.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                      <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all ${w.enabled ? 'right-0.5' : 'left-0.5'}`} />
                    </div>
                  </button>
                  <button onClick={() => handleEdit(w)} className="p-1.5 rounded text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                    <Icon name={IconName.Edit} className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(w.id)} className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                    <Icon name={IconName.Delete} className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Endpoint URL */}
              <div className="flex items-center gap-2 mb-2">
                <code className="flex-1 text-xs font-mono text-on-surface-secondary bg-gray-100 dark:bg-slate-800 px-3 py-1.5 rounded truncate">
                  {getEndpointUrl(w.endpoint_token)}
                </code>
                <button onClick={() => copyToClipboard(getEndpointUrl(w.endpoint_token), w.id)}
                  className="px-2.5 py-1.5 rounded text-xs font-medium bg-gray-200 dark:bg-slate-600 hover:bg-gray-300 dark:hover:bg-slate-500 transition-colors whitespace-nowrap">
                  {copied === w.id ? 'Copied!' : 'Copy URL'}
                </button>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-xs text-on-surface-secondary">
                <span>{w.call_count} calls</span>
                {w.last_called && <span>Last called: {new Date(w.last_called).toLocaleString()}</span>}
                {w.auth_token && <span className="flex items-center gap-1"><Icon name={IconName.Shield} className="w-3 h-3" /> Auth protected</span>}
                <button onClick={() => handleViewLogs(w)} className="text-primary hover:underline ml-auto">View Logs →</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
