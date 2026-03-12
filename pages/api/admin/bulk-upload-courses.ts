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
  tax_percent?: number | string;
  course_fees_include_gst?: string;
  renewed_status?: string;
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

// Parse trainer data from mixed formats, e.g.:
//   "Name [email1;email2], Name [email3], bare@email.com, Name [unclosed@email.com"
// Returns an array of email groups — one group per trainer.
// Emails inside the same [...] are grouped (same trainer with multiple emails).
// Bare emails (no brackets) each become their own single-email group.
// Handles unclosed brackets too.
const parseTrainerEmailGroups = (raw: string | undefined): string[][] => {
  if (!raw) return [];

  const groups: string[][] = [];

  // Remove all bracket blocks (closed and unclosed), collecting their email groups.
  // \[([^\]]*)\]? matches "[" + content + optional "]"
  const withoutBrackets = raw.replace(/\[([^\]]*)\]?/g, (_match, inner) => {
    const emails = inner
      .split(';')
      .map((e: string) => e.trim().toLowerCase())
      .filter((e: string) => e.includes('@'));
    if (emails.length > 0) groups.push(emails);
    return ' '; // replace with space so surrounding text doesn't merge
  });

  // Extract any remaining bare emails not inside brackets
  const emailRegex = /[\w.+\-]+@[\w.\-]+\.\w+/g;
  let m;
  while ((m = emailRegex.exec(withoutBrackets)) !== null) {
    groups.push([m[0].toLowerCase()]);
  }

  return groups;
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
// hasSecondaryEmail: pass result of one-time column check done before the main loop.
async function associateTrainers(
  client: any,
  courseId: string | undefined,
  trainerRaw: string | undefined,
  hasSecondaryEmail: boolean
): Promise<string[]> {
  if (!courseId || !trainerRaw) return [];

  const emailGroups = parseTrainerEmailGroups(trainerRaw);
  if (emailGroups.length === 0) return [];

  // For each trainer (group of emails), try each email until a match is found.
  // If ANY email in the group matches (primary or secondary), the trainer is found.
  const unmatched: string[] = [];
  const matchedIds: string[] = [];

  for (const emailGroup of emailGroups) {
    let foundId: string | null = null;

    for (const email of emailGroup) {
      const query = hasSecondaryEmail
        ? 'SELECT id FROM app_user WHERE LOWER(email) = $1 OR LOWER(secondary_email) = $1'
        : 'SELECT id FROM app_user WHERE LOWER(email) = $1';
      const res = await client.query(query, [email]);
      if (res.rows.length > 0) {
        foundId = res.rows[0].id;
        break;
      }
    }

    if (foundId) {
      matchedIds.push(foundId);
    } else {
      // Show all emails that were tried so the admin knows exactly what was searched
      unmatched.push(emailGroup.join(' / '));
    }
  }

  if (matchedIds.length > 0) {
    // Delete old associations then bulk-insert new ones in a single query
    await client.query('DELETE FROM course_trainer WHERE course_id = $1', [courseId]);
    const placeholders = matchedIds.map((_, i) => `($1, $${i + 2})`).join(', ');
    await client.query(
      `INSERT INTO course_trainer (course_id, trainer_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      [courseId, ...matchedIds]
    );
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

  // Check once whether secondary_email column exists (safe fallback if migration not yet run)
  let hasSecondaryEmail = false;
  try {
    const colCheck = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'app_user' AND column_name = 'secondary_email'
    `);
    hasSecondaryEmail = colCheck.rows.length > 0;
  } catch (_) { /* ignore */ }

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
          toFloat(course.tax_percent),             // 11
          toText(course.course_fees_include_gst),  // 12
          toFloat(course.after_normal_funding),    // 13
          toFloat(course.after_mces_funding),      // 14
          toInt(course.num_of_days),              // 15
          toInt(course.num_of_trainers),          // 16
          toText(course.course_link),             // 17
          toText(course.assessment_record_link),  // 18
          toText(course.courseware_link),         // 19
          toText(course.brochure_link),           // 20
          toText(course.google_classroom),        // 21
          toText(course.google_classroom_code),   // 22
          toText(course.learner_guide_url),       // 23
          toText(course.skillsfuture_link),       // 24
          toText(course.sf_for_business_link),    // 25
          toText(course.skills_framework),        // 26
          toBool(course.da),                      // 27
          toFloat(course.average_score),          // 28
          toFloat(course.star_rating),            // 29
          toInt(course.num_responders),           // 30
          toText(course.description),             // 31
          toText(course.course_outline),          // 32
          toBool(course.is_utap_eligible),        // 33
          toText(course.renewed_status),          // 34
        ];

        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE course SET
               title=$1, course_type=$2, tsc_title=$3, tsc_code=$4,
               training_hours=$5, assessment_hours=$6,
               domain=$7, schedule_id=$8, funding_validity=$9,
               course_fees_exclude_gst=$10, tax_percent=$11, course_fees_include_gst=$12,
               after_normal_funding=$13, after_mces_funding=$14,
               num_of_days=$15, num_of_trainers=$16,
               course_link=$17, assessment_record_link=$18, courseware_link=$19,
               brochure_link=$20, google_classroom=$21, google_classroom_code=$22,
               learner_guide_url=$23, skillsfuture_link=$24, sf_for_business_link=$25,
               skills_framework=$26, da=$27, average_score=$28, star_rating=$29,
               num_responders=$30, description=$31, course_outline=$32,
               is_utap_eligible=$33, renewed_status=$34,
               updated_at=NOW()
             WHERE course_code=$35`,
            [...values, course_code.trim()]
          );

          const courseId = existing.rows[0]?.id;

          await client.query('COMMIT');

          const unmatched = await associateTrainers(client, courseId, course.trainers, hasSecondaryEmail);
          results.push({
            course_code, title, action: 'updated',
            message: 'Course updated successfully.',
            unmatchedTrainers: unmatched.length ? unmatched : undefined,
          });
          updated++;
        } else {
          const insertResult = await client.query(
            `INSERT INTO course (
               title, course_type, tsc_title, tsc_code,
               training_hours, assessment_hours,
               domain, schedule_id, funding_validity,
               course_fees_exclude_gst, tax_percent, course_fees_include_gst,
               after_normal_funding, after_mces_funding,
               num_of_days, num_of_trainers,
               course_link, assessment_record_link, courseware_link,
               brochure_link, google_classroom, google_classroom_code,
               learner_guide_url, skillsfuture_link, sf_for_business_link,
               skills_framework, da, average_score, star_rating,
               num_responders, description, course_outline,
               is_utap_eligible, renewed_status,
               course_code, created_at, updated_at
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
               $28,$29,$30,$31,$32,$33,$34,$35,NOW(),NOW()
             ) RETURNING id`,
            [...values, course_code.trim()]
          );

          const courseId = insertResult.rows[0]?.id;

          await client.query('COMMIT');

          const unmatched = await associateTrainers(client, courseId, course.trainers, hasSecondaryEmail);
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
