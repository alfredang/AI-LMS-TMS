import { MmsSyncError, type RunSnapshot } from './contract';

const correctionMs = 3 * 60 * 60 * 1000;

/** Last scheduled Singapore teaching end, plus the three-hour correction window. */
export function automaticSyncUntil(snapshot: Pick<RunSnapshot, 'sessions'> & Partial<Pick<RunSnapshot, 'schema_version' | 'class_end_date'>>): string {
    if (snapshot.schema_version === 2) return snapshot.class_end_date ? new Date(`${snapshot.class_end_date}T23:59:59.999+08:00`).toISOString() : '2100-12-31T15:59:59.999Z';
    const ends = snapshot.sessions.map(session => new Date(`${session.date}T${session.end_time}:00+08:00`).getTime());
    if (!ends.length || ends.some(end => !Number.isFinite(end)))
        throw new MmsSyncError('Verify every scheduled session end before MMS synchronization.', 'assignment_pending');
    return new Date(Math.max(...ends) + correctionMs).toISOString();
}

export function assertAutomaticSyncOpen(until: string | Date | null | undefined, now = new Date()): void {
    if (!until || !Number.isFinite(new Date(until).getTime()) || new Date(until).getTime() <= now.getTime())
        throw new MmsSyncError('Automatic MMS synchronization closed three hours after the last scheduled session. Use an authorized one-off Sync MMS now for a later correction.', 'sync_window_closed');
}
