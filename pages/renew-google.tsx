import { useState } from 'react';
import Head from 'next/head';

// /renew-google — one-click Google token renewal for admins.
// Direct-linkable from incident chats: the admin opens this page (must be
// logged in), clicks the button, signs in as the Email User (sales@) in the
// Google consent screen, and the oauth-callback route saves the new refresh
// token. Same flow as Company Settings → Integration → Google → "Renew via
// Google Sign-In", minus the navigation.
export default function RenewGooglePage() {
    const [status, setStatus] = useState<{ kind: 'idle' | 'starting' | 'error'; message?: string }>({ kind: 'idle' });

    const startRenewal = async () => {
        setStatus({ kind: 'starting' });
        try {
            const resp = await fetch('/api/integrations/google/oauth-start', { method: 'POST' });
            if (resp.status === 401 || resp.status === 403) {
                setStatus({ kind: 'error', message: 'You must be logged in as an Admin first. Log in on the home page, then come back to this link.' });
                return;
            }
            const data = await resp.json();
            if (!resp.ok || !data?.url) throw new Error(data?.error || `HTTP ${resp.status}`);
            window.location.href = data.url;
        } catch (err: any) {
            setStatus({ kind: 'error', message: err?.message || String(err) });
        }
    };

    return (
        <>
            <Head><title>Renew Google Token</title></Head>
            <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white px-6">
                <div className="max-w-lg w-full text-center space-y-6 py-16">
                    <h1 className="text-2xl font-bold">Renew Google Token</h1>
                    <p className="text-slate-300 leading-relaxed">
                        Fixes <code className="text-red-400">invalid_grant</code> errors on assessment
                        submissions, certificate emails, Drive uploads and calendar sync. You will be
                        sent to Google — sign in as the company mailbox (the configured Email User),
                        not your personal account.
                    </p>
                    <button
                        onClick={startRenewal}
                        disabled={status.kind === 'starting'}
                        className="px-8 py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-lg font-semibold"
                    >
                        {status.kind === 'starting' ? 'Starting…' : 'Renew via Google Sign-In'}
                    </button>
                    {status.kind === 'error' && (
                        <p className="text-red-400 text-sm">{status.message}</p>
                    )}
                    <p className="text-slate-500 text-sm">
                        Requires an Admin or Training Provider login. After Google confirms
                        &ldquo;Google Token Renewed&rdquo;, submissions work again immediately.
                    </p>
                </div>
            </div>
        </>
    );
}
