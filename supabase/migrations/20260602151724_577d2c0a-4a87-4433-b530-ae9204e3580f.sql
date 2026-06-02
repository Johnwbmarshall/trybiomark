CREATE TABLE public.verification_appeals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  decision_token TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  user_email TEXT,
  project_name TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  screen_video_path TEXT NOT NULL,
  webcam_video_path TEXT NOT NULL,
  original_pdf_path TEXT NOT NULL,
  gemini_checks JSONB NOT NULL,
  gemini_summary TEXT NOT NULL DEFAULT '',
  user_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_email TEXT NOT NULL,
  reviewer_notes TEXT,
  decided_at TIMESTAMPTZ,
  certificate_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
);

GRANT SELECT ON public.verification_appeals TO authenticated;
GRANT ALL ON public.verification_appeals TO service_role;

ALTER TABLE public.verification_appeals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own appeals"
ON public.verification_appeals
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER trg_appeals_updated_at
BEFORE UPDATE ON public.verification_appeals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_appeals_user_id ON public.verification_appeals(user_id);
CREATE INDEX idx_appeals_decision_token ON public.verification_appeals(decision_token);