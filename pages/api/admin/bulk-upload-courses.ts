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
  slides_url?: string;
  lesson_plan_url?: string;
  facilitator_guide_url?: string;
  trainer_slides_url?: string;
  activities_url?: string;
  assessment_plan_url?: string;
  practical_performance_assessment_link?: string;
  written_assessment_link?: string;
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
}

const toFloat = (v: any): number | null => {
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? null : n;
};

// Returns null if value exceeds PostgreSQL numeric(precision, scale) limits
const toNumeric = (v: any, precision: number, scale: number): number | null => {
  const n = parseFloat(String(v ?? ''));
  if (isNaN(n)) return null;
  const maxIntDigits = precision - scale;
  const maxValue = Math.pow(10, maxIntDigits) - Math.pow(10, -scale);
  if (Math.abs(n) > maxValue) return null;
  return parseFloat(n.toFixed(scale));
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
          toFloat(course.training_hours) ?? 0,              //  5
          toFloat(course.assessment_hours) ?? 0,            //  6
          toText(course.domain),                            //  7
          toText(course.schedule_id),                       //  8
          toText(course.funding_validity),                   //  9
          toText(course.course_fees_exclude_gst),           // 10
          toNumeric(course.tax_percent, 5, 2),              // 11  numeric(5,2)  max 999.99
          toText(course.course_fees_include_gst),           // 12
          toNumeric(course.after_normal_funding, 12, 2),   // 13  numeric(12,2)
          toNumeric(course.after_mces_funding, 12, 2),     // 14  numeric(12,2)
          toInt(course.num_of_days),              // 15
          toInt(course.num_of_trainers),          // 16
          toText(course.course_link),             // 17
          toText(course.assessment_record_link),  // 18
          toText(course.courseware_link),         // 19
          toText(course.brochure_link),           // 20
          toText(course.google_classroom),        // 21
          toText(course.google_classroom_code),   // 22
          toText(course.learner_guide_url),                          // 23
          toText(course.skillsfuture_link),                          // 24
          toText(course.sf_for_business_link),                       // 25
          toText(course.skills_framework),                           // 26
          toBool(course.da),                                         // 27
          toNumeric(course.average_score, 5, 2),                    // 28  numeric(5,2)  max 999.99
          toNumeric(course.star_rating, 3, 1),                      // 29  numeric(3,1)  max 9.9
          toInt(course.num_responders),                              // 30
          toText(course.description),                                // 31
          toText(course.course_outline),                             // 32
          toBool(course.is_utap_eligible),                           // 33
          toText(course.renewed_status),                             // 34
          toText(course.slides_url),                                 // 35
          toText(course.lesson_plan_url),                            // 36
          toText(course.facilitator_guide_url),                      // 37
          toText(course.trainer_slides_url),                         // 38
          toText(course.assessment_plan_url),                        // 39
          toText(course.practical_performance_assessment_link),      // 40
          toText(course.written_assessment_link),                    // 41
          toText(course.activities_url),                             // 42
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
               slides_url=$35, lesson_plan_url=$36, facilitator_guide_url=$37,
               trainer_slides_url=$38, assessment_plan_url=$39,
               practical_performance_assessment_link=$40, written_assessment_link=$41,
               activities_url=$42,
               updated_at=NOW()
             WHERE course_code=$43`,
            [...values, course_code.trim()]
          );

          await client.query('COMMIT');

          results.push({ course_code, title, action: 'updated', message: 'Course updated successfully.' });
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
               slides_url, lesson_plan_url, facilitator_guide_url,
               trainer_slides_url, assessment_plan_url,
               practical_performance_assessment_link, written_assessment_link,
               activities_url,
               course_code, created_at, updated_at
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
               $28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,NOW(),NOW()
             ) RETURNING id`,
            [...values, course_code.trim()]
          );

          await client.query('COMMIT');

          results.push({ course_code, title, action: 'created', message: 'Course created successfully.' });
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
