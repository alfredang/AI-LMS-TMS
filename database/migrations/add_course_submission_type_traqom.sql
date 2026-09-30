-- TPG's latest submission type and the course-related report's TRAQOM measures.
-- Percentages are stored as 0..100 (not 0..1); the rating is on a 0..5 scale.
ALTER TABLE public.course ADD COLUMN IF NOT EXISTS submission_type text;
ALTER TABLE public.course ADD COLUMN IF NOT EXISTS traqom_response_rate numeric(6,2);
ALTER TABLE public.course ADD COLUMN IF NOT EXISTS traqom_quality_rating numeric(3,2);
