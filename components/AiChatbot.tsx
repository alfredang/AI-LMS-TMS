import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { CHAT_TEMPLATES, ChatTemplate, buildChatUrl, supportsPrefill } from './chatTemplates';

/**
 * Floating external-agent chat launcher.
 *
 * Replaces the former in-app Nemo chat window. Rather than a built-in agent, the
 * platform hands off to an external channel (WhatsApp or Telegram) which in turn
 * fronts an external agent such as OpenClaw or Hermes.
 *
 * Clicking the launcher opens a searchable template picker: each template is a
 * fill-in-the-blank TMS request (add trainer to a class, submit a run to SSG, …)
 * so the user sends structured input the agent can act on rather than free text.
 * Picking one copies it to the clipboard and opens the chat, pre-filling the
 * message where the channel supports it (see supportsPrefill).
 *
 * Configured per-tenant under Company Settings → Integrations → AI Agent →
 * Chat Link (training_provider.whatsapp_chat_url). When unset the launcher
 * renders nothing, so tenants without an external channel get no dead button.
 *
 * Styling mirrors the tertiaryinfotech.com launcher (see .chat-launcher in
 * styles/globals.css for the pulse/halo animations).
 */

const WHATSAPP = {
    name: 'WhatsApp',
    accent: '#0B6E4F',
    glow: 'rgba(11,110,79,0.45)',
    ring: 'rgba(11,110,79,0.55)',
    viewBox: '0 0 448 512',
    path: 'M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zM223.9 438.7c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z',
};

const TELEGRAM = {
    name: 'Telegram',
    accent: '#2AABEE',
    glow: 'rgba(42,171,238,0.45)',
    ring: 'rgba(42,171,238,0.55)',
    viewBox: '0 0 496 512',
    path: 'M248 8C111.033 8 0 119.033 0 256s111.033 248 248 248 248-111.033 248-248S384.967 8 248 8zm114.952 168.66c-3.732 39.215-19.881 134.378-28.1 178.3-3.476 18.584-10.322 24.816-16.948 25.425-14.4 1.325-25.338-9.517-39.287-18.661-21.827-14.308-34.158-23.215-55.346-37.177-24.485-16.135-8.612-25 5.342-39.5 3.652-3.793 67.107-61.51 68.335-66.746.153-.655.3-3.1-1.154-4.384s-3.59-.849-5.135-.5q-3.283.746-104.608 69.142-14.845 10.194-26.894 9.934c-8.855-.191-25.888-5.006-38.551-9.123-15.531-5.048-27.875-7.717-26.8-16.291q.84-6.7 18.45-13.7 108.446-47.248 144.628-62.3c68.872-28.647 83.183-33.623 92.511-33.789 2.052-.034 6.639.474 9.61 2.885a10.452 10.452 0 013.53 6.716 43.765 43.765 0 01.417 9.769z',
};

const AiChatbot: React.FC = () => {
    const { trainingProviderProfile } = useLms();
    const chatUrl = trainingProviderProfile?.integrations?.whatsappChatUrl?.trim();

    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    // Close on outside click / Escape, and focus the search box on open.
    useEffect(() => {
        if (!isOpen) return;
        const onDown = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        searchRef.current?.focus();
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [isOpen]);

    const grouped = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matches = q
            ? CHAT_TEMPLATES.filter(t =>
                  `${t.label} ${t.category} ${t.keywords || ''}`.toLowerCase().includes(q))
            : CHAT_TEMPLATES;
        return matches.reduce<Record<string, ChatTemplate[]>>((acc, t) => {
            (acc[t.category] ||= []).push(t);
            return acc;
        }, {});
    }, [query]);

    if (!chatUrl) return null;

    const isTelegram = /(?:^|\/\/)(?:t\.me|telegram\.(?:me|org|dog))\b/i.test(chatUrl);
    const channel = isTelegram ? TELEGRAM : WHATSAPP;
    const canPrefill = supportsPrefill(chatUrl);

    const handlePick = async (t: ChatTemplate) => {
        // Always copy: on group-invite links the message can't be pre-filled, so
        // the clipboard is the only way to carry the template across.
        try {
            await navigator.clipboard.writeText(t.body);
            setCopiedId(t.id);
            setTimeout(() => setCopiedId(null), 1800);
        } catch {
            /* clipboard blocked (insecure context / permission) — still open the chat */
        }
        window.open(buildChatUrl(chatUrl, t.body), '_blank', 'noopener,noreferrer');
    };

    const totalShown = Object.values(grouped).reduce((n, list) => n + list.length, 0);

    return (
        <div className="hidden md:block fixed bottom-6 right-6 z-50">
            {isOpen && (
                <div
                    ref={panelRef}
                    role="dialog"
                    aria-label="Chat message templates"
                    className="absolute bottom-20 right-0 w-[26rem] max-h-[70vh] flex flex-col rounded-xl bg-surface shadow-2xl border border-default overflow-hidden dark:bg-gray-800 dark:border-gray-700"
                >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-default dark:border-gray-700">
                        <div>
                            <h3 className="text-sm font-bold text-on-surface">Ask the AI Agent</h3>
                            <p className="text-[11px] text-on-surface-secondary">
                                Pick a template, fill in the blanks, send on {channel.name}
                            </p>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            aria-label="Close templates"
                            className="p-1.5 rounded-full text-on-surface-secondary hover:bg-surface-elevated dark:hover:bg-gray-700"
                        >
                            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    </div>

                    <div className="px-3 py-2 border-b border-default dark:border-gray-700">
                        <input
                            ref={searchRef}
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search templates, e.g. trainer, SSG, invoice…"
                            className="w-full px-3 py-1.5 text-sm rounded-md bg-surface-elevated border border-default text-on-surface placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        />
                    </div>

                    <div className="flex-1 overflow-y-auto px-2 py-2">
                        {totalShown === 0 && (
                            <p className="px-2 py-6 text-center text-sm text-on-surface-secondary">
                                No template matches “{query}”.
                            </p>
                        )}
                        {Object.entries(grouped).map(([category, list]) => (
                            <div key={category} className="mb-2">
                                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-on-surface-secondary">
                                    {category}
                                </p>
                                {list.map(t => (
                                    <button
                                        key={t.id}
                                        onClick={() => handlePick(t)}
                                        className="w-full text-left px-2 py-1.5 rounded-md text-sm text-on-surface hover:bg-surface-elevated dark:hover:bg-gray-700 flex items-center justify-between gap-2"
                                    >
                                        <span>{t.label}</span>
                                        {copiedId === t.id && (
                                            <span className="text-[10px] text-green-600 dark:text-green-400 shrink-0">Copied</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>

                    <div className="px-4 py-2 border-t border-default dark:border-gray-700">
                        <p className="text-[10px] text-on-surface-secondary">
                            {canPrefill
                                ? `The message opens pre-filled in ${channel.name}.`
                                : `Group links can't be pre-filled — the template is copied to your clipboard, so just paste it in ${channel.name}.`}
                        </p>
                    </div>
                </div>
            )}

            <button
                type="button"
                onClick={() => setIsOpen(o => !o)}
                aria-label={isOpen ? 'Close chat templates' : `Chat on ${channel.name}`}
                aria-expanded={isOpen}
                title={`Chat on ${channel.name}`}
                style={
                    {
                        backgroundColor: channel.accent,
                        boxShadow: `0 8px 30px ${channel.glow}`,
                        '--chat-accent': channel.accent,
                        '--chat-accent-glow': channel.glow,
                        '--chat-accent-ring': channel.ring,
                    } as React.CSSProperties
                }
                className="chat-launcher flex w-14 h-14 rounded-full items-center justify-center transition hover:scale-105"
            >
                <svg aria-hidden="true" viewBox={channel.viewBox} fill="currentColor" className="w-7 h-7 text-white">
                    <path d={channel.path} />
                </svg>
            </button>
        </div>
    );
};

export default AiChatbot;
