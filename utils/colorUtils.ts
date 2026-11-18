/**
 * Color and Theme Management Utilities
 * Handles dynamic application of Training Provider's color scheme and theme across the application
 */

export type ThemeMode = 'light' | 'dark';
/** What the user picked on their profile; 'system' follows the device setting. */
export type ThemePreference = ThemeMode | 'system';

// Only an explicit choice (profile Appearance picker or header sun/moon) is stored here.
// The older 'trainingProviderTheme' key was also written automatically, so it is not a
// real choice: it is dropped and everyone starts on System again (19 Nov 2026).
const THEME_STORAGE_KEY = 'lmsThemePreference';
const LEGACY_THEME_STORAGE_KEY = 'trainingProviderTheme';
const COLOR_STORAGE_KEY = 'trainingProviderPrimaryColor';
/** Every user (all roles) follows the device until they pick Light or Dark on their profile. */
const DEFAULT_PREFERENCE: ThemePreference = 'system';
/** Fallback when the device setting cannot be read (server render, no matchMedia). */
const DEFAULT_THEME: ThemeMode = 'light';
const DEFAULT_COLOR = '#3b82f6';

/**
 * Converts a hex color to RGB values
 */
export const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
};

/**
 * Converts RGB values to hex color
 */
export const rgbToHex = (r: number, g: number, b: number): string => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

/**
 * Darkens a hex color by a specified percentage
 */
export const darkenHexColor = (hex: string, percent: number): string => {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    const factor = (100 - percent) / 100;
    const r = Math.round(rgb.r * factor);
    const g = Math.round(rgb.g * factor);
    const b = Math.round(rgb.b * factor);

    return rgbToHex(r, g, b);
};

/**
 * Lightens a hex color by a specified percentage
 */
export const lightenHexColor = (hex: string, percent: number): string => {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    const factor = percent / 100;
    const r = Math.round(rgb.r + (255 - rgb.r) * factor);
    const g = Math.round(rgb.g + (255 - rgb.g) * factor);
    const b = Math.round(rgb.b + (255 - rgb.b) * factor);

    return rgbToHex(r, g, b);
};

/**
 * Gets the current theme from document
 */
export const getCurrentTheme = (): ThemeMode => {
    if (typeof document === 'undefined') return DEFAULT_THEME;
    const theme = document.documentElement.getAttribute('data-theme');
    return (theme === 'light' || theme === 'dark') ? theme : DEFAULT_THEME;
};

/**
 * Applies the theme mode to the document
 */
export const applyTheme = (theme: ThemeMode, persist: boolean = false): void => {
    if (typeof document === 'undefined') return;

    // Temporarily disable transitions for instant theme switch
    document.documentElement.classList.add('no-transitions');
    document.documentElement.setAttribute('data-theme', theme);

    // Update the 'dark' class for Tailwind CSS
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }

    // Re-enable transitions after a brief delay
    setTimeout(() => {
        document.documentElement.classList.remove('no-transitions');
    }, 50);

    if (persist) localStorage.setItem(THEME_STORAGE_KEY, theme);

    // The brand colour's shades differ per theme, so re-derive them on every switch.
    if (activeBrandColor) applyPrimaryColor(activeBrandColor);
};

/** Fired on window when the saved preference changes (header button or profile picker). */
export const THEME_PREFERENCE_EVENT = 'themepreferencechange';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

/** The stored preference ('light' | 'dark' | 'system'); System when nothing is stored. */
export const getThemePreference = (): ThemePreference => {
    if (typeof window === 'undefined') return DEFAULT_PREFERENCE;
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : DEFAULT_PREFERENCE;
};

/** The light/dark theme a preference resolves to right now. */
export const resolveThemePreference = (pref: ThemePreference): ThemeMode => {
    if (pref !== 'system') return pref;
    if (typeof window === 'undefined' || !window.matchMedia) return DEFAULT_THEME;
    return window.matchMedia(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light';
};

/**
 * Applies a preference without storing it. For 'system' it also follows the
 * device live (e.g. macOS switching to dark at sunset).
 */
const applyPreference = (pref: ThemePreference): void => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia ? window.matchMedia(SYSTEM_DARK_QUERY) : null;
    if (mq && systemListener) {
        mq.removeEventListener('change', systemListener);
        systemListener = null;
    }
    applyTheme(resolveThemePreference(pref), false);
    if (pref === 'system' && mq) {
        systemListener = (e) => applyTheme(e.matches ? 'dark' : 'light', false);
        mq.addEventListener('change', systemListener);
    }
};

/** Saves the user's Light / Dark / System choice (this browser) and applies it. */
export const setThemePreference = (pref: ThemePreference): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(THEME_STORAGE_KEY, pref);
    applyPreference(pref);
    window.dispatchEvent(new CustomEvent(THEME_PREFERENCE_EVENT, { detail: pref }));
};

/**
 * Toggles between light and dark theme
 */
export const toggleTheme = (): ThemeMode => {
    const currentTheme = getCurrentTheme();
    const newTheme: ThemeMode = currentTheme === 'dark' ? 'light' : 'dark';
    setThemePreference(newTheme);
    return newTheme;
};

/** WCAG relative luminance / contrast ratio of two hex colours. */
const luminance = (hex: string): number => {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    const ch = [rgb.r, rgb.g, rgb.b].map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
export const contrastRatio = (a: string, b: string): number => {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Darken (or lighten) in small steps until the colour reaches `min` contrast against `against`. */
const adjustForContrast = (hex: string, against: string, min: number, direction: 'darken' | 'lighten'): string => {
    let c = hex;
    for (let i = 0; i < 40 && contrastRatio(c, against) < min; i++) {
        c = direction === 'darken' ? darkenHexColor(c, 4) : lightenHexColor(c, 6);
    }
    return c;
};

// Surfaces the brand colour must stay readable on (mirror the tokens in styles/globals.css).
const LIGHT_BG = '#e8eefa';
const DARK_SURFACE = '#1e293b';

/** Tenant brand colour last applied, re-derived whenever the theme changes. */
let activeBrandColor: string | null = null;

const channels = (hex: string): string => {
    const rgb = hexToRgb(hex);
    return rgb ? `${rgb.r} ${rgb.g} ${rgb.b}` : '47 91 230';
};

/**
 * Applies the tenant's brand colour (training_provider colour scheme) for the current theme.
 * The hue is kept; the shade is adjusted so white text on it, and the colour used as text, both
 * pass WCAG AA (4.5:1) in the active theme. Sets the design-system tokens
 * --c-primary (fills), --c-primary-hover and --c-primary-text (links / accent text).
 */
export const applyPrimaryColor = (primaryColor: string | { primary: string }): void => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    let colorHex: string;
    if (typeof primaryColor === 'string') {
        colorHex = primaryColor;
    } else if (primaryColor && typeof primaryColor === 'object' && primaryColor.primary) {
        colorHex = primaryColor.primary;
    } else {
        colorHex = DEFAULT_COLOR;
    }
    if (!hexToRgb(colorHex)) colorHex = DEFAULT_COLOR;
    activeBrandColor = colorHex;

    const fill = adjustForContrast(colorHex, '#ffffff', 4.5, 'darken');
    const hover = darkenHexColor(fill, 12);
    const text = getCurrentTheme() === 'dark'
        ? adjustForContrast(colorHex, DARK_SURFACE, 5.5, 'lighten')
        : adjustForContrast(fill, LIGHT_BG, 4.5, 'darken');

    root.style.setProperty('--c-primary', channels(fill));
    root.style.setProperty('--c-primary-hover', channels(hover));
    root.style.setProperty('--c-primary-text', channels(text));
};

/**
 * Gets the current primary color from CSS custom properties
 */
export const getCurrentPrimaryColor = (): string => {
    if (typeof document === 'undefined') return DEFAULT_COLOR;
    const root = document.documentElement;
    const ch = getComputedStyle(root).getPropertyValue('--c-primary').trim().split(/\s+/).map(Number);
    return ch.length === 3 && ch.every(n => !Number.isNaN(n)) ? rgbToHex(ch[0], ch[1], ch[2]) : DEFAULT_COLOR;
};

/**
 * Initializes the color scheme and theme based on Training Provider profile
 */
export const initializeColorScheme = (trainingProviderProfile?: {
    colorScheme?: string;
    themeMode?: ThemeMode;
}): void => {
    // Theme first: a tenant-forced mode wins, otherwise the user's stored
    // preference (Light / Dark / System).
    if (trainingProviderProfile?.themeMode) {
        applyTheme(trainingProviderProfile.themeMode);
    } else {
        applyPreference(getThemePreference());
    }

    // Initialize color
    let primaryColor: string | undefined;

    if (trainingProviderProfile?.colorScheme) {
        try {
            const parsed = JSON.parse(trainingProviderProfile.colorScheme);
            primaryColor = parsed.primary;
        } catch {
            primaryColor = trainingProviderProfile.colorScheme;
        }
    }

    if (primaryColor) {
        console.log(`🎨 Initializing color scheme with Training Provider color: ${primaryColor}`);
        applyPrimaryColor(primaryColor);
        ColorSchemeManager.getInstance().updatePrimaryColor(primaryColor);
    } else {
        ColorSchemeManager.getInstance().loadFromLocalStorage();
        console.log('🎨 No Training Provider color found, checking localStorage...');
    }
};

/**
 * Color and theme scheme management class
 */
export class ColorSchemeManager {
    private static instance: ColorSchemeManager;
    private currentPrimaryColor: string = DEFAULT_COLOR;
    private currentTheme: ThemeMode = DEFAULT_THEME;

    static getInstance(): ColorSchemeManager {
        if (!ColorSchemeManager.instance) {
            ColorSchemeManager.instance = new ColorSchemeManager();
        }
        return ColorSchemeManager.instance;
    }

    /**
     * Updates the primary color and applies it immediately
     */
    updatePrimaryColor(color: string): void {
        this.currentPrimaryColor = color;
        applyPrimaryColor(color);
        localStorage.setItem(COLOR_STORAGE_KEY, color);
    }

    /**
     * Gets the current primary color
     */
    getPrimaryColor(): string {
        return this.currentPrimaryColor;
    }

    /**
     * Updates the theme and applies it immediately
     */
    updateTheme(theme: ThemeMode): void {
        this.currentTheme = theme;
        setThemePreference(theme);
    }

    /**
     * Gets the current theme
     */
    getTheme(): ThemeMode {
        return this.currentTheme;
    }

    /**
     * Toggles the theme
     */
    toggleTheme(): ThemeMode {
        const newTheme = toggleTheme();
        this.currentTheme = newTheme;
        return newTheme;
    }

    /**
     * Loads color and theme from localStorage if available
     */
    loadFromLocalStorage(): void {
        const storedColor = localStorage.getItem(COLOR_STORAGE_KEY);
        if (storedColor) {
            this.updatePrimaryColor(storedColor);
        }

        const pref = getThemePreference();
        applyPreference(pref);
        this.currentTheme = resolveThemePreference(pref);
    }

    /**
     * Resets to default color scheme and theme
     */
    resetToDefault(): void {
        this.updatePrimaryColor(DEFAULT_COLOR);
        localStorage.removeItem(COLOR_STORAGE_KEY);
        localStorage.removeItem(THEME_STORAGE_KEY);
        applyPreference(DEFAULT_PREFERENCE);
        this.currentTheme = resolveThemePreference(DEFAULT_PREFERENCE);
    }
}

/**
 * Hook for React components to easily manage color scheme and theme
 */
export const useColorScheme = () => {
    const manager = ColorSchemeManager.getInstance();

    return {
        currentColor: manager.getPrimaryColor(),
        currentTheme: manager.getTheme(),
        updateColor: (color: string) => manager.updatePrimaryColor(color),
        updateTheme: (theme: ThemeMode) => manager.updateTheme(theme),
        toggleTheme: () => manager.toggleTheme(),
        resetToDefault: () => manager.resetToDefault(),
        applyColor: (color: string) => applyPrimaryColor(color)
    };
};
