ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS verification_notes JSONB;

ALTER TABLE public.certificates
  ALTER COLUMN verification_status SET DEFAULT 'pending';