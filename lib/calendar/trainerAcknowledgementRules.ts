import type { TrainerResolutionResult } from './trainerIdentityRules';

/** No course-wide acknowledgement: every acceptance belongs to an exact event/run/date/person. */
export function acknowledgementKey(runUuid: string, eventId: string, sessionDate: string, trainerId: string): string {
  return JSON.stringify([runUuid, eventId, sessionDate, trainerId]);
}
export function sessionAcknowledgement(runUuid: string, eventId: string, sessionDate: string, resolution: TrainerResolutionResult) {
  if (resolution.source !== 'gcal_accepted' || !resolution.trainer) return null;
  return { key: acknowledgementKey(runUuid, eventId, sessionDate, resolution.trainer.user_id), runUuid, eventId, sessionDate, trainerId: resolution.trainer.user_id };
}
