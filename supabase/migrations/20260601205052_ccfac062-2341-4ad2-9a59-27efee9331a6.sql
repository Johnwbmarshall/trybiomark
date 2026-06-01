
-- Certificates table
CREATE TABLE public.certificates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  certificate_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  screen_video_path TEXT,
  webcam_video_path TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_certificates_user_id ON public.certificates(user_id);
CREATE INDEX idx_certificates_certificate_id ON public.certificates(certificate_id);

GRANT SELECT, INSERT ON public.certificates TO authenticated;
GRANT ALL ON public.certificates TO service_role;

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own certificates"
ON public.certificates FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own certificates"
ON public.certificates FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Public safe view: never exposes video paths or user_id
CREATE VIEW public.public_certificates
WITH (security_invoker = true)
AS
SELECT
  certificate_id,
  project_name,
  created_at,
  verification_status,
  duration_seconds
FROM public.certificates;

GRANT SELECT ON public.public_certificates TO anon, authenticated;

-- Allow anonymous lookups by certificate_id only via the view
CREATE POLICY "Public can read certificates via view"
ON public.certificates FOR SELECT
TO anon
USING (true);

-- The above grants anon SELECT on the underlying table only when going
-- through the security_invoker view. To actually restrict columns, we
-- revoke direct table access from anon (already not granted) and only
-- grant the view. Drop the anon policy above and rely on view-only grant:
DROP POLICY "Public can read certificates via view" ON public.certificates;

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('recordings', 'recordings', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can write/read only their own folder (recordings/{user_id}/...)
CREATE POLICY "Users upload to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'recordings'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users read own recordings"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'recordings'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users delete own recordings"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'recordings'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
