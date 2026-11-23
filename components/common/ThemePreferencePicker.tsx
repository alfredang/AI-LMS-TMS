import React, { useEffect, useState } from 'react';
import { ThemePreference, THEME_PREFERENCE_EVENT, getThemePreference, setThemePreference } from '@utils/colorUtils';

const OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    {
        value: 'light',
        label: 'Light',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="12" cy="12" r="4" />
                <path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
        ),
    },
    {
        value: 'dark',
        label: 'Dark',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
            </svg>
        ),
    },
    {
        value: 'system',
        label: 'System',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path strokeLinecap="round" d="M8 20h8M12 16v4" />
            </svg>
        ),
    },
];

const HINT: Record<ThemePreference, string> = {
    light: 'Light theme on this device',
    dark: 'Dark theme on this device',
    system: 'Follows your device setting (default)',
};

/** Appearance row for every profile page: Light / Dark / System (the default). Saved per browser. */
const ThemePreferencePicker: React.FC = () => {
    const [pref, setPref] = useState<ThemePreference>('system');

    // Read after mount so the server and first client render agree, then
    // follow the header button when it changes the preference.
    useEffect(() => {
        setPref(getThemePreference());
        const sync = () => setPref(getThemePreference());
        window.addEventListener(THEME_PREFERENCE_EVENT, sync);
        return () => window.removeEventListener(THEME_PREFERENCE_EVENT, sync);
    }, []);

    const choose = (value: ThemePreference) => {
        setPref(value);
        setThemePreference(value);
    };

    return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-lg border border-default bg-gray-50/60 dark:bg-gray-800/40">
            <div>
                <p className="font-semibold text-on-surface">Theme</p>
                <p className="text-sm text-muted">{HINT[pref]}</p>
            </div>
            <div role="radiogroup" aria-label="Theme" className="inline-flex p-1 rounded-lg bg-surface-elevated border border-default">
                {OPTIONS.map((o) => {
                    const active = pref === o.value;
                    return (
                        <button
                            key={o.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => choose(o.value)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active
                                ? 'bg-surface text-primary shadow-sm'
                                : 'text-on-surface-secondary hover:text-on-surface'
                                }`}
                        >
                            {o.icon}
                            <span>{o.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default ThemePreferencePicker;
