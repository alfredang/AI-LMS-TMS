/**
 * Safely extracts the local YYYY-MM-DD from a Date object, string, or timestamp.
 * Forces the timezone to Asia/Singapore to prevent UTC backward shifts that happen
 * when using .toISOString().slice(0, 10) on local dates between midnight and 8 AM SGT.
 */
export function getLocalYMD(dateVal: Date | string | number | null | undefined): string {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    
    // 'en-CA' outputs strictly 'YYYY-MM-DD'
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}
