CREATE TABLE public.recording_drafts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_name TEXT NOT NULL,
  screen_video_path TEXT NOT NULL,
  webcam_video_path TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recording_drafts TO authenticated;
GRANT ALL ON public.recording_drafts TO service_role;

ALTER TABLE public.recording_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own drafts"
ON public.recording_drafts FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own drafts"
ON public.recording_drafts FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update their own drafts"
ON public.recording_drafts FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete their own drafts"
ON public.recording_drafts FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_recording_drafts_user_created
  ON public.recording_drafts (user_id, created_at DESC);
