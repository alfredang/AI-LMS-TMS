import React, { useEffect, useState } from 'react';
import { ThemeMode, getCurrentTheme, setThemePreference } from '@utils/colorUtils';

/**
 * One-click sun/moon button in the header. It sets an explicit Light or Dark
 * preference; "System" is chosen on the profile page (Appearance).
 */
const HeaderThemeToggle: React.FC = () => {
    const [theme, setTheme] = useState<ThemeMode>('light');

    // Track the live theme, so the icon stays right when the profile picker
    // or the device ("System") changes it.
    useEffect(() => {
        setTheme(getCurrentTheme());
        const observer = new MutationObserver(() => setTheme(getCurrentTheme()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';

    return (
        <button
            type="button"
            onClick={() => setThemePreference(next)}
            aria-label={`Switch to ${next} theme`}
            title={`Switch to ${next} theme`}
            className="icon-btn-round"
        >
            {theme === 'dark' ? (
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <circle cx="12" cy="12" r="4" />
                    <path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
            ) : (
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
                </svg>
            )}
        </button>
    );
};

export default HeaderThemeToggle;
