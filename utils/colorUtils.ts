/**
 * Color and Theme Management Utilities
 * Handles dynamic application of Training Provider's color scheme and theme across the application
 */

export type ThemeMode = 'light' | 'dark';
/** What the user picked on their profile; 'system' follows the device setting. */
export type ThemePreference = ThemeMode | 'system';

const THEME_STORAGE_KEY = 'trainingProviderTheme';
const COLOR_STORAGE_KEY = 'trainingProviderPrimaryColor';
const DEFAULT_THEME: ThemeMode = 'dark';
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
export const applyTheme = (theme: ThemeMode, persist: boolean = true): void => {
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
};

/** Fired on window when the saved preference changes (header button or profile picker). */
export const THEME_PREFERENCE_EVENT = 'themepreferencechange';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

/** The stored preference ('light' | 'dark' | 'system'); dark when nothing is stored. */
export const getThemePreference = (): ThemePreference => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : DEFAULT_THEME;
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
    applyTheme(newTheme);
    return newTheme;
};

/**
 * Applies the primary color to the document root
 */
export const applyPrimaryColor = (primaryColor: string | { primary: string }): void => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;

    // Handle both string and object formats
    let colorHex: string;
    if (typeof primaryColor === 'string') {
        colorHex = primaryColor;
    } else if (primaryColor && typeof primaryColor === 'object' && primaryColor.primary) {
        colorHex = primaryColor.primary;
    } else {
        colorHex = DEFAULT_COLOR;
    }

    // Convert to RGB for opacity variants
    const rgb = hexToRgb(colorHex);
    const rgbString = rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : '59, 130, 246';

    // Set CSS custom properties
    root.style.setProperty('--primary', colorHex);
    root.style.setProperty('--primary-hover', colorHex);
    root.style.setProperty('--primary-rgb', rgbString);
    root.style.setProperty('--border-focus', colorHex);

    // For dark theme, also adjust the lighter variant
    const currentTheme = getCurrentTheme();
    if (currentTheme === 'dark') {
        const lighterColor = lightenHexColor(colorHex, 20);
        root.style.setProperty('--primary', lighterColor);
        root.style.setProperty('--border-focus', lighterColor);
        const lighterRgb = hexToRgb(lighterColor);
        if (lighterRgb) {
            root.style.setProperty('--primary-rgb', `${lighterRgb.r}, ${lighterRgb.g}, ${lighterRgb.b}`);
        }
    }

    console.log(`🎨 Applied primary color: ${colorHex} (rgb: ${rgbString})`);
};

/**
 * Gets the current primary color from CSS custom properties
 */
export const getCurrentPrimaryColor = (): string => {
    if (typeof document === 'undefined') return DEFAULT_COLOR;
    const root = document.documentElement;
    const primaryColor = getComputedStyle(root).getPropertyValue('--primary').trim();
    return primaryColor || DEFAULT_COLOR;
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
        applyTheme(theme);
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
        this.updateTheme(DEFAULT_THEME);
        localStorage.removeItem(COLOR_STORAGE_KEY);
        localStorage.removeItem(THEME_STORAGE_KEY);
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
