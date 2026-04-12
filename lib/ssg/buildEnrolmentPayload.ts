import { inferIdType } from '../utils/id-type';

/**
 * Shared helper for building SSG enrolment payloads from a da_application row.
 * Used by both the manual endpoint (pages/api/admin/da-enrol.ts) and the
 * auto-enrol pipeline (lib/autoEnrolDirectApplications.ts).
 */

function buildIdType(id: string, raw: string): string {
  return inferIdType(id, raw);
}

function buildSponsorshipType(raw: string): string {
  return (raw || '').toUpperCase().includes('EMPLOYER') ? 'EMPLOYER' : 'INDIVIDUAL';
}

export function buildEnrolmentPayload(
  app: Record<string, any>,
  uen: string,
  tpCode: string
): object {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

  const trainee: Record<string, any> = {
    idType: { type: buildIdType(String(app.trainee_id || ''), app.trainee_id_type) },
    id: String(app.trainee_id || ''),
    dateOfBirth: app.date_of_birth ? String(app.date_of_birth).split('T')[0] : undefined,
    fullName: String(app.trainee_name || ''),
    emailAddress: String(app.trainee_email || ''),
    sponsorshipType: buildSponsorshipType(app.sponsorship_type),
    fees: {
      discountAmount: 0,
      collectionStatus: 'Pending Payment',
    },
    enrolmentDate: today,
  };

  if (app.trainee_phone) {
    trainee.contactNumber = {
      countryCode: String(app.trainee_phone_country_code || '65'),
      areaCode: '',
      phoneNumber: String(app.trainee_phone),
    };
  }

  return {
    enrolment: {
      trainingPartner: {
        uen,
        code: tpCode,
      },
      course: {
        referenceNumber: String(app.course_reference_number || ''),
        run: { id: String(app.course_run_id || '') },
      },
      trainee,
    },
  };
}
