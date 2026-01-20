/**
 * Color Management Utilities
 * Handles dynamic application of Training Provider's color scheme across the entire application
 */

/**
 * Converts a hex color to RGB values
 * @param hex - Hex color string (e.g., "#3b82f6")
 * @returns RGB object with r, g, b values
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
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 * @returns Hex color string
 */
export const rgbToHex = (r: number, g: number, b: number): string => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

/**
 * Darkens a hex color by a specified percentage
 * @param hex - Hex color string
 * @param percent - Percentage to darken (0-100)
 * @returns Darkened hex color
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
 * Applies the primary color to the document root (no hover variation)
 * @param primaryColor - The primary hex color or color object
 */
export const applyPrimaryColor = (primaryColor: string | { primary: string }): void => {
    const root = document.documentElement;
    
    // Handle both string and object formats
    let colorHex: string;
    if (typeof primaryColor === 'string') {
        // If it's already a string, use it directly
        colorHex = primaryColor;
    } else if (primaryColor && typeof primaryColor === 'object' && primaryColor.primary) {
        // If it's an object with primary property, extract the hex
        colorHex = primaryColor.primary;
    } else {
        // Fallback to default blue
        colorHex = '#3b82f6';
    }
    
    // Convert to RGB for opacity variants
    const rgb = hexToRgb(colorHex);
    const rgbString = rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : '59, 130, 246'; // fallback

    // Set CSS custom properties (no hover variation, same color for both states)
    root.style.setProperty('--primary', colorHex);
    root.style.setProperty('--primary-hover', colorHex);
    root.style.setProperty('--primary-rgb', rgbString);

    console.log(`🎨 Applied primary color: ${colorHex} (no hover variation, rgb: ${rgbString})`);
};

/**
 * Gets the current primary color from CSS custom properties
 * @returns Current primary color hex string
 */
export const getCurrentPrimaryColor = (): string => {
    const root = document.documentElement;
    const primaryColor = getComputedStyle(root).getPropertyValue('--primary').trim();
    return primaryColor || '#3b82f6'; // fallback to default blue
};

/**
 * Initializes the color scheme based on Training Provider profile
 * Should be called when the app loads or when Training Provider profile is loaded
 * @param trainingProviderProfile - Training Provider profile with color scheme
 */
export const initializeColorScheme = (trainingProviderProfile?: { colorScheme?: string }): void => {
    let primaryColor: string | undefined;
    
    // Handle different color scheme formats
    if (trainingProviderProfile?.colorScheme) {
        // Try to parse as JSON first (in case it's stored as JSON string in database)
        try {
            const parsed = JSON.parse(trainingProviderProfile.colorScheme);
            primaryColor = parsed.primary;
        } catch {
            // If parsing fails, treat as direct hex string
            primaryColor = trainingProviderProfile.colorScheme;
        }
    }
    
    if (primaryColor) {
        console.log(`🎨 Initializing color scheme with Training Provider color: ${primaryColor}`);
        applyPrimaryColor(primaryColor);
        
        // Store for persistence across page reloads
        ColorSchemeManager.getInstance().updatePrimaryColor(primaryColor);
    } else {
        // Try to load from localStorage if no profile color provided
        ColorSchemeManager.getInstance().loadFromLocalStorage();
        console.log('🎨 No Training Provider color found, checking localStorage...');
    }
};

/**
 * Color scheme management class for more advanced operations
 */
export class ColorSchemeManager {
    private static instance: ColorSchemeManager;
    private currentPrimaryColor: string = '#3b82f6';

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
        
        // Store in localStorage for persistence
        localStorage.setItem('trainingProviderPrimaryColor', color);
    }

    /**
     * Gets the current primary color
     */
    getPrimaryColor(): string {
        return this.currentPrimaryColor;
    }

    /**
     * Loads color from localStorage if available
     */
    loadFromLocalStorage(): void {
        const storedColor = localStorage.getItem('trainingProviderPrimaryColor');
        if (storedColor) {
            this.updatePrimaryColor(storedColor);
        }
    }

    /**
     * Resets to default color scheme
     */
    resetToDefault(): void {
        const defaultColor = '#3b82f6';
        this.updatePrimaryColor(defaultColor);
        localStorage.removeItem('trainingProviderPrimaryColor');
    }
}

/**
 * Hook for React components to easily manage color scheme
 */
export const useColorScheme = () => {
    const manager = ColorSchemeManager.getInstance();

    return {
        currentColor: manager.getPrimaryColor(),
        updateColor: (color: string) => manager.updatePrimaryColor(color),
        resetToDefault: () => manager.resetToDefault(),
        applyColor: (color: string) => applyPrimaryColor(color)
    };
};