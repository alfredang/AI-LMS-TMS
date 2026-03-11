import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface CourseRow {
  course_code: string;
  title: string;
  course_type?: string;
  tsc_title?: string;
  tsc_code?: string;
  training_hours?: number | string;
  assessment_hours?: number | string;
  domain?: string;
  schedule_id?: string;
  funding_validity?: string;
  course_fees_exclude_gst?: string;
  after_normal_funding?: number | string;
  after_mces_funding?: number | string;
  num_of_days?: number | string;
  num_of_trainers?: number | string;
  course_link?: string;
  assessment_record_link?: string;
  courseware_link?: string;
  brochure_link?: string;
  google_classroom?: string;
  google_classroom_code?: string;
  learner_guide_url?: string;
  skillsfuture_link?: string;
  sf_for_business_link?: string;
  skills_framework?: string;
  da?: boolean | string | number;
  average_score?: number | string;
  star_rating?: number | string;
  num_responders?: number | string;
  description?: string;
  course_outline?: string;
  is_utap_eligible?: boolean | string | number;
  trainers?: string;
}

// Parse "Name [email], Name [email]" → array of lowercase emails
const parseTrainerEmails = (raw: string | undefined): string[] => {
  if (!raw) return [];
  const matches = raw.match(/\[([^\]]+)\]/g) || [];
  return matches.map(m => m.slice(1, -1).trim().toLowerCase()).filter(Boolean);
};

const toFloat = (v: any): number | null => {
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? null : n;
};

const toInt = (v: any): number | null => {
  const n = parseInt(String(v ?? ''), 10);
  return isNaN(n) ? null : n;
};

// number > 0 → true; "true"/"yes" → true; everything else → false
const toBool = (v: any): boolean => {
  if (v === null || v === undefined || v === '') return false;
  const n = parseFloat(String(v));
  if (!isNaN(n)) return n > 0;
  const s = String(v).toLowerCase().trim();
  return s === 'true' || s === 'yes';
};

const toText = (v: any): string | null => {
  const s = String(v ?? '').trim();
  return s || null;
};

// Associate trainers with a course by email lookup.
// Replaces existing associations for this course, returns unmatched emails.
async function associateTrainers(
  client: any,
  courseId: string | undefined,
  trainerRaw: string | undefined
): Promise<string[]> {
  if (!courseId || !trainerRaw) return [];

  const emails = parseTrainerEmails(trainerRaw);
  if (emails.length === 0) return [];

  // Look up each email in app_user
  const unmatched: string[] = [];
  const matchedIds: string[] = [];

  for (const email of emails) {
    const res = await client.query(
      'SELECT id FROM app_user WHERE LOWER(email) = $1',
      [email]
    );
    if (res.rows.length > 0) {
      matchedIds.push(res.rows[0].id);
    } else {
      unmatched.push(email);
    }
  }

  if (matchedIds.length > 0) {
    // Remove existing associations then re-insert
    await client.query('DELETE FROM course_trainer WHERE course_id = $1', [courseId]);
    for (const trainerId of matchedIds) {
      await client.query(
        `INSERT INTO course_trainer (course_id, trainer_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [courseId, trainerId]
      );
    }
  }

  return unmatched;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { courses } = req.body as { courses: CourseRow[] };

  if (!Array.isArray(courses) || courses.length === 0) {
    return res.status(400).json({ success: false, message: 'No course data provided.' });
  }

  const results: Array<{
    course_code: string;
    title: string;
    action: 'created' | 'updated' | 'failed';
    message: string;
    unmatchedTrainers?: string[];
  }> = [];

  let created = 0;
  let updated = 0;
  let failed = 0;

  const client = await pool.connect();

  try {
    for (const course of courses) {
      const { course_code, title } = course;

      if (!course_code || !title) {
        results.push({
          course_code: course_code || '(unknown)',
          title: title || '(unknown)',
          action: 'failed',
          message: 'Missing required fields: Course Code and Title are required.',
        });
        failed++;
        continue;
      }

      const courseTypeVal = (() => {
        const raw = (course.course_type || '').trim().toUpperCase();
        if (raw === 'WSQ') return 'WSQ';
        if (raw === 'IBF') return 'IBF';
        return 'Non-WSQ';
      })();

      try {
        await client.query('BEGIN');

        const existing = await client.query(
          'SELECT id FROM course WHERE course_code = $1',
          [course_code.trim()]
        );

        // Ordered list of column values — positions match SQL placeholders
        const values = [
          title.trim(),                            //  1
          courseTypeVal,                            //  2
          toText(course.tsc_title),                //  3
          toText(course.tsc_code),                 //  4
          toFloat(course.training_hours) ?? 0,     //  5
          toFloat(course.assessment_hours) ?? 0,   //  6
          toText(course.domain),                   //  7
          toText(course.schedule_id),              //  8
          toText(course.funding_validity),          //  9
          toText(course.course_fees_exclude_gst),  // 10
          toFloat(course.after_normal_funding),     // 11
          toFloat(course.after_mces_funding),       // 12
          toInt(course.num_of_days),               // 13
          toInt(course.num_of_trainers),           // 14
          toText(course.course_link),              // 15
          toText(course.assessment_record_link),   // 16
          toText(course.courseware_link),          // 17
          toText(course.brochure_link),            // 18
          toText(course.google_classroom),         // 19
          toText(course.google_classroom_code),    // 20
          toText(course.learner_guide_url),        // 21
          toText(course.skillsfuture_link),        // 22
          toText(course.sf_for_business_link),     // 23
          toText(course.skills_framework),         // 24
          toBool(course.da),                       // 25
          toFloat(course.average_score),           // 26
          toFloat(course.star_rating),             // 27
          toInt(course.num_responders),            // 28
          toText(course.description),              // 29
          toText(course.course_outline),           // 30
          toBool(course.is_utap_eligible),         // 31
        ];

        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE course SET
               title=$1, course_type=$2, tsc_title=$3, tsc_code=$4,
               training_hours=$5, assessment_hours=$6,
               domain=$7, schedule_id=$8, funding_validity=$9,
               course_fees_exclude_gst=$10,
               after_normal_funding=$11, after_mces_funding=$12,
               num_of_days=$13, num_of_trainers=$14,
               course_link=$15, assessment_record_link=$16, courseware_link=$17,
               brochure_link=$18, google_classroom=$19, google_classroom_code=$20,
               learner_guide_url=$21, skillsfuture_link=$22, sf_for_business_link=$23,
               skills_framework=$24, da=$25, average_score=$26, star_rating=$27,
               num_responders=$28, description=$29, course_outline=$30,
               is_utap_eligible=$31,
               updated_at=NOW()
             WHERE course_code=$32`,
            [...values, course_code.trim()]
          );

          // Get updated course id for trainer association
          const updatedCourse = await client.query(
            'SELECT id FROM course WHERE course_code = $1',
            [course_code.trim()]
          );
          const courseId = updatedCourse.rows[0]?.id;

          await client.query('COMMIT');

          const unmatched = await associateTrainers(client, courseId, course.trainers);
          results.push({
            course_code, title, action: 'updated',
            message: 'Course updated successfully.',
            unmatchedTrainers: unmatched.length ? unmatched : undefined,
          });
          updated++;
        } else {
          await client.query(
            `INSERT INTO course (
               title, course_type, tsc_title, tsc_code,
               training_hours, assessment_hours,
               domain, schedule_id, funding_validity, course_fees_exclude_gst,
               after_normal_funding, after_mces_funding,
               num_of_days, num_of_trainers,
               course_link, assessment_record_link, courseware_link,
               brochure_link, google_classroom, google_classroom_code,
               learner_guide_url, skillsfuture_link, sf_for_business_link,
               skills_framework, da, average_score, star_rating,
               num_responders, description, course_outline,
               is_utap_eligible,
               course_code, created_at, updated_at
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
               $28,$29,$30,$31,$32,NOW(),NOW()
             )`,
            [...values, course_code.trim()]
          );

          const insertedCourse = await client.query(
            'SELECT id FROM course WHERE course_code = $1',
            [course_code.trim()]
          );
          const courseId = insertedCourse.rows[0]?.id;

          await client.query('COMMIT');

          const unmatched = await associateTrainers(client, courseId, course.trainers);
          results.push({
            course_code, title, action: 'created',
            message: 'Course created successfully.',
            unmatchedTrainers: unmatched.length ? unmatched : undefined,
          });
          created++;
        }
      } catch (rowError) {
        await client.query('ROLLBACK');
        const msg = rowError instanceof Error ? rowError.message : 'Unknown error';
        results.push({ course_code, title, action: 'failed', message: msg });
        failed++;
      }
    }
  } finally {
    client.release();
  }

  return res.status(200).json({
    success: true,
    data: { created, updated, failed, results },
  });
}
