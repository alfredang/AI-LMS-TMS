/**
 * Utility functions for inferring ID types based on the ID string format.
 * This is crucial for matching the correct idType code to SSG API expectations.
 */

import { IdTypeSummary } from '../ssg/constants';

/**
 * Detects whether an ID is an NRIC, FIN, or OTHERS based on its format.
 * 
 * NRIC: Starts with S or T, 7 digits, ends with a letter
 * FIN: Starts with F, G, or M, 7 digits, ends with a letter
 * 
 * @param id The ID string to check
 * @returns The detected IdTypeSummary value
 */
export function detectIdType(id: string): string {
    if (!id) return IdTypeSummary.OTHERS;

    const cleanId = id.trim().toUpperCase();
    
    // NRIC regex: Starts with S or T, followed by 7 digits, ends with a letter
    if (/^[ST]\d{7}[A-Z]$/.test(cleanId)) {
        return IdTypeSummary.NRIC;
    }
    
    // FIN regex: Starts with F, G, or M, followed by 7 digits, ends with a letter
    if (/^[FGM]\d{7}[A-Z]$/.test(cleanId)) {
        return IdTypeSummary.FIN;
    }
    
    return IdTypeSummary.OTHERS;
}

/**
 * Infers the ID type, using the explicitly provided type if valid, 
 * otherwise falling back to auto-detection from the ID string.
 * 
 * @param id The ID string
 * @param explicitType The optionally provided ID type (e.g., from an API payload or Excel column)
 * @returns The inferred IdTypeSummary value
 */
export function inferIdType(id: string, explicitType?: string | null): string {
    // If an explicit type is provided and it's FIN or PASSPORT (or OTHERS), respect it
    if (explicitType) {
        const cleanType = explicitType.trim().toUpperCase();
        if (cleanType.includes('FIN')) return IdTypeSummary.FIN;
        if (cleanType.includes('PASSPORT') || cleanType === 'OTHERS') return IdTypeSummary.OTHERS;
        if (cleanType.includes('NRIC')) return IdTypeSummary.NRIC;
    }
    
    // If explicit type is missing or unrecognized, auto-detect
    return detectIdType(id);
}
