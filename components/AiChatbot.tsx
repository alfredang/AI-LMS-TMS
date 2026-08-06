import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import {
    CHAT_TEMPLATES,
    STARTER_TEMPLATE_IDS,
    TRAINER_TEMPLATES,
    TRAINER_STARTER_TEMPLATE_IDS,
    ChatTemplate,
    buildChatUrl,
    supportsPrefill,
} from './chatTemplates';
import { UserRole } from '@app-types';
import { getApiUrl } from '@/lib/urlHelpers';

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

/** Trainer support uses a blue palette to distinguish it from ops support. */
const WHATSAPP_TRAINER = {
    ...WHATSAPP,
    accent: '#1B5E8C',
    glow: 'rgba(27,94,140,0.45)',
    ring: 'rgba(27,94,140,0.55)',
};

const AiChatbot: React.FC = () => {
    const { trainingProviderProfile, role, currentUser } = useLms();

    // Trainers get their own group and a deliberately narrow template set — no
    // schedules, run IDs, enrolments, SSG or finance actions.
    const isTrainer = role === UserRole.Trainer;

    // The provider profile is fetched once at login and cached in context, so a
    // session that predates a newly-added link would never see it. Fall back to
    // a direct fetch rather than silently rendering nothing.
    const [fallbackLinks, setFallbackLinks] = useState<Record<string, string> | null>(null);
    const integrations = trainingProviderProfile?.integrations as Record<string, string> | undefined;
    const linkKey = isTrainer ? 'trainerWhatsappChatUrl' : 'whatsappChatUrl';
    const cachedUrl = integrations?.[linkKey];

    useEffect(() => {
        // Only reach out when the cached profile exists but lacks this key.
        if (!integrations || cachedUrl !== undefined || fallbackLinks) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(getApiUrl(`/api/training-provider/info${currentUser?.id ? `?userId=${currentUser.id}` : ''}`));
                const json = await res.json();
                if (!cancelled) setFallbackLinks(json?.data?.referenceLinks || {});
            } catch {
                if (!cancelled) setFallbackLinks({});
            }
        })();
        return () => { cancelled = true; };
    }, [integrations, cachedUrl, fallbackLinks, currentUser?.id]);

    const chatUrl = (cachedUrl ?? fallbackLinks?.[linkKey])?.trim();
    const templates = isTrainer ? TRAINER_TEMPLATES : CHAT_TEMPLATES;
    const starterIds = isTrainer ? TRAINER_STARTER_TEMPLATE_IDS : STARTER_TEMPLATE_IDS;

    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<ChatTemplate | null>(null);
    const [draft, setDraft] = useState('');
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
    const [showAll, setShowAll] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    // Close on outside click / Escape, and focus the search box on open.
    useEffect(() => {
        if (!isOpen) return;
        const onDown = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        // Escape backs out of the detail view first, then closes the panel.
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            setSelected(prev => {
                if (prev) return null;
                setIsOpen(false);
                return prev;
            });
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        if (!selected) searchRef.current?.focus();
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [isOpen, selected]);

    // With no search term, show a short starter set — the full catalogue of 40
    // would swamp the panel. Typing surfaces everything else.
    const grouped = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matches = q
            ? templates.filter(t =>
                  `${t.label} ${t.category} ${t.keywords || ''}`.toLowerCase().includes(q))
            : showAll
              ? templates
              : templates.filter(t => starterIds.includes(t.id));
        return matches.reduce<Record<string, ChatTemplate[]>>((acc, t) => {
            (acc[t.category] ||= []).push(t);
            return acc;
        }, {});
    }, [query, showAll, templates, starterIds]);

    /** Group headings only help once the list is long. */
    const showCategoryHeadings = query.trim() !== '' || showAll;

    if (!chatUrl) return null;

    const isTelegram = /(?:^|\/\/)(?:t\.me|telegram\.(?:me|org|dog))\b/i.test(chatUrl);
    const channel = isTelegram ? TELEGRAM : isTrainer ? WHATSAPP_TRAINER : WHATSAPP;
    const canPrefill = supportsPrefill(chatUrl);

    /**
     * Copy synchronously via execCommand. This has to stay non-async: awaiting
     * navigator.clipboard first consumes the click's transient activation, so
     * the window.open that follows gets swallowed by the popup blocker, and by
     * the time the promise settles the new tab has taken focus — which makes
     * both the async write and any fallback fail, leaving nothing to paste.
     */
    const copyTextSync = (text: string): boolean => {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, text.length); // iOS Safari ignores select() alone
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch {
            return false;
        }
    };

    /** Async Clipboard API, used only to rescue a failed synchronous copy. */
    const copyTextAsync = async (text: string): Promise<boolean> => {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    };

    const flashCopyState = (ok: boolean) => {
        setCopyState(ok ? 'copied' : 'failed');
        setTimeout(() => setCopyState('idle'), 2500);
    };

    const handleCopy = async () => {
        if (!selected) return;
        // No navigation here, so either order is safe; sync first keeps the two
        // buttons on identical behaviour.
        const ok = copyTextSync(draft) || (await copyTextAsync(draft));
        flashCopyState(ok);
    };

    const handleOpenChat = () => {
        // WhatsApp group links can't carry a pre-filled body, so the clipboard is
        // the only way across. Both the copy and the open must happen in this
        // one synchronous turn to stay inside the click's user activation.
        const copied = canPrefill ? true : copyTextSync(draft);
        window.open(buildChatUrl(chatUrl, draft), '_blank', 'noopener,noreferrer');

        if (canPrefill) return;
        if (copied) {
            flashCopyState(true);
            return;
        }
        // Sync path failed — try the async API as a last resort. It often still
        // succeeds because the opened tab has not stolen focus yet.
        void copyTextAsync(draft).then(flashCopyState);
    };

    const totalShown = Object.values(grouped).reduce((n, list) => n + list.length, 0);

    return (
        <div className="hidden md:block fixed bottom-6 right-6 z-50">
            {isOpen && (
                <div
                    ref={panelRef}
                    role="dialog"
                    aria-label="Chat message templates"
                    className="absolute bottom-20 right-0 w-[26rem] max-h-[70vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden bg-[#0d1418] border border-black/20"
                >
                    {/* Header — the channel accent, so the panel reads as part of the launcher */}
                    <div
                        style={{ backgroundColor: channel.accent }}
                        className="flex items-center justify-between px-4 py-3 text-white"
                    >
                        <div className="flex items-center gap-2.5 min-w-0">
                            {selected ? (
                                <button
                                    onClick={() => setSelected(null)}
                                    aria-label="Back to suggestions"
                                    className="p-1 -ml-1 rounded-full hover:bg-white/15 shrink-0"
                                >
                                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                                    </svg>
                                </button>
                            ) : (
                                <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center shrink-0">
                                    <svg aria-hidden="true" viewBox={channel.viewBox} fill="currentColor" className="w-4 h-4">
                                        <path d={channel.path} />
                                    </svg>
                                </span>
                            )}
                            <div className="min-w-0">
                                <h3 className="text-sm font-semibold truncate">
                                    {selected
                                        ? selected.label
                                        : isTrainer
                                          ? 'Trainer LMS/TMS Support'
                                          : 'TIA Operation Support (Kael)'}
                                </h3>
                                <p className="text-[11px] text-white/75 truncate">
                                    {selected ? 'Tap to edit, then send' : 'Online · ask me anything'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            aria-label="Close chat"
                            className="p-1.5 -mr-1 rounded-full hover:bg-white/15 shrink-0"
                        >
                            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    </div>

                    {/* Conversation area — light, like a chat thread */}
                    <div className="flex-1 overflow-y-auto bg-[#f6f7f5] px-4 py-4">
                        {!selected && (
                            <>
                                <div className="bg-white rounded-xl rounded-tl-sm px-4 py-3 shadow-sm max-w-[92%]">
                                    <p className="text-[13px] leading-relaxed text-gray-800">
                                        Hi there.
                                        <br />
                                        What would you like to do in the TMS today?
                                    </p>
                                </div>

                                {!showCategoryHeadings && (
                                    <p className="mt-4 mb-2 text-[11px] font-bold tracking-wide text-gray-500">
                                        SUGGESTED QUESTIONS
                                    </p>
                                )}

                                <div className="space-y-2">
                                    {totalShown === 0 && (
                                        <p className="py-6 text-center text-sm text-gray-500">
                                            Nothing matches “{query}”.
                                        </p>
                                    )}
                                    {Object.entries(grouped).map(([category, list]) => (
                                        <div key={category} className="space-y-2">
                                            {showCategoryHeadings && (
                                                <p className="pt-2 text-[11px] font-bold tracking-wide text-gray-500">
                                                    {category.toUpperCase()}
                                                </p>
                                            )}
                                            {list.map(t => (
                                                <button
                                                    key={t.id}
                                                    onClick={() => { setSelected(t); setDraft(t.body); setCopyState('idle'); }}
                                                    className="w-full text-left px-4 py-2.5 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-gray-800 hover:border-gray-300 hover:shadow-sm transition"
                                                >
                                                    {t.label}
                                                </button>
                                            ))}
                                        </div>
                                    ))}
                                </div>

                                {/* Trainers see every template already, so the toggle would be a no-op. */}
                                {query.trim() === '' && templates.length > starterIds.length && (
                                    <button
                                        onClick={() => setShowAll(v => !v)}
                                        className="mt-3 text-[12px] font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2"
                                    >
                                        {showAll
                                            ? 'Show fewer suggestions'
                                            : `Browse all ${templates.length} requests`}
                                    </button>
                                )}
                            </>
                        )}

                        {selected && (
                            <>
                                <div className="bg-white rounded-xl rounded-tl-sm px-4 py-3 shadow-sm max-w-[92%]">
                                    <p className="text-[13px] leading-relaxed text-gray-800">
                                        {canPrefill ? (
                                            <>Fill in the details below, then send it over on {channel.name}.</>
                                        ) : (
                                            <>
                                                Fill in the details below, then tap <b>Copy &amp; open {channel.name}</b> and
                                                <b> paste</b> it into the group.
                                            </>
                                        )}
                                    </p>
                                </div>

                                {/* The draft, styled as the user's own outgoing bubble */}
                                <div className="mt-3 ml-auto max-w-[92%]">
                                    <textarea
                                        value={draft}
                                        onChange={e => setDraft(e.target.value)}
                                        rows={Math.min(14, draft.split('\n').length + 1)}
                                        spellCheck={false}
                                        aria-label="Message to send"
                                        className="w-full px-4 py-3 text-[13px] leading-relaxed rounded-xl rounded-br-sm bg-[#dcf8c6] text-gray-900 border border-transparent focus:outline-none focus:border-gray-300 resize-y shadow-sm"
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <div className="px-3 py-2.5 bg-white border-t border-gray-200">
                        {selected ? (
                            <>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleCopy}
                                        className="flex-1 px-3 py-2 text-[13px] font-medium rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                                    >
                                        {copyState === 'copied' ? 'Copied ✓' : copyState === 'failed' ? 'Press Ctrl/⌘+C' : 'Copy'}
                                    </button>
                                    <button
                                        onClick={handleOpenChat}
                                        style={{ backgroundColor: channel.accent }}
                                        className="flex-[1.6] px-3 py-2 text-[13px] font-medium rounded-full text-white hover:opacity-90 flex items-center justify-center gap-2"
                                    >
                                        {canPrefill ? `Send on ${channel.name}` : `Copy & open ${channel.name}`}
                                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                        </svg>
                                    </button>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1.5">
                                    {copyState === 'failed'
                                        ? 'Clipboard blocked by the browser — select the message above and copy it manually, then paste it in the group.'
                                        : canPrefill
                                          ? `Opens ${channel.name} with this message already typed.`
                                          : `WhatsApp doesn't let a website post into a group — the message is copied for you, so just press Ctrl/⌘+V in the chat.`}
                                </p>
                            </>
                        ) : (
                            <div className="flex items-center gap-2">
                                <input
                                    ref={searchRef}
                                    type="text"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    onKeyDown={e => {
                                        // Enter picks the first match, like sending a message.
                                        if (e.key !== 'Enter') return;
                                        const first = Object.values(grouped)[0]?.[0];
                                        if (first) { setSelected(first); setDraft(first.body); setCopyState('idle'); }
                                    }}
                                    placeholder="Type your message..."
                                    className="flex-1 px-4 py-2 text-[13px] rounded-full bg-white border border-gray-300 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0"
                                />
                                <button
                                    onClick={() => {
                                        const first = Object.values(grouped)[0]?.[0];
                                        if (first) { setSelected(first); setDraft(first.body); setCopyState('idle'); }
                                    }}
                                    aria-label="Use the first matching suggestion"
                                    style={{ backgroundColor: channel.accent }}
                                    className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0 hover:opacity-90"
                                >
                                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                    </svg>
                                </button>
                            </div>
                        )}
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
