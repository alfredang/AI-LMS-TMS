-- Point skillsfuture_link at the current MySkillsFuture course directory for
-- every WSQ and CASL course.
--
-- The old links used the retired portal URL
-- (www.myskillsfuture.gov.sg/content/portal/en/training-exchange/...), which no
-- longer resolves. The directory now lives at
-- https://courses.myskillsfuture.gov.sg/courses/<code>, keyed by the code in
-- force today — a renewed course is listed ONLY under its renewed code (the
-- original 404s), so build from COALESCE(NULLIF(new_course_code,''), course_code).
--
-- Idempotent: rows already carrying the exact target URL are skipped, so a
-- second run updates 0 rows.

UPDATE public.course
   SET skillsfuture_link =
         'https://courses.myskillsfuture.gov.sg/courses/'
         || COALESCE(NULLIF(new_course_code, ''), course_code),
       updated_at = now()
 WHERE course_type IN ('WSQ', 'CASL')
   AND COALESCE(NULLIF(new_course_code, ''), course_code) LIKE 'TGS-%'
   AND skillsfuture_link IS DISTINCT FROM
         'https://courses.myskillsfuture.gov.sg/courses/'
         || COALESCE(NULLIF(new_course_code, ''), course_code);
