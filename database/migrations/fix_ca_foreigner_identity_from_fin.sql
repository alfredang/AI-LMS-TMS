-- Company Application uploads may contain contradictory identity fields, e.g.
-- Trainee Identity Type = "Singapore Citizen" while ID Type / NRIC-FIN is FIN.
-- FINs are issued to foreigners, so correct the stored citizenship field.

UPDATE public.company_application
   SET trainee_identity_type = 'Foreigner',
       trainee_id_type = CASE
         WHEN UPPER(TRIM(COALESCE(trainee_nric, ''))) ~ '^[FGM][0-9]{7}[A-Z]$'
           OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%fin%'
           OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%work permit%'
           OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%employment pass%'
           OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%s pass%'
         THEN 'FIN'
         ELSE trainee_id_type
       END
 WHERE ca_cancelled_at IS NULL
   AND (
     UPPER(TRIM(COALESCE(trainee_nric, ''))) ~ '^[FGM][0-9]{7}[A-Z]$'
     OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%fin%'
     OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%work permit%'
     OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%employment pass%'
     OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%s pass%'
     OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%passport%'
   )
   AND (
     trainee_identity_type IS DISTINCT FROM 'Foreigner'
     OR (
       trainee_id_type IS DISTINCT FROM 'FIN'
       AND (
         UPPER(TRIM(COALESCE(trainee_nric, ''))) ~ '^[FGM][0-9]{7}[A-Z]$'
         OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%fin%'
         OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%work permit%'
         OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%employment pass%'
         OR LOWER(TRIM(COALESCE(trainee_id_type, ''))) LIKE '%s pass%'
       )
     )
   );
