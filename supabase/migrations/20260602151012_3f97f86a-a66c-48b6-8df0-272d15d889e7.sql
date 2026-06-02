CREATE TABLE public.evidence_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  certificate_id TEXT NOT NULL,
  owner_user_id UUID NOT NULL,
  requester_email TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  requester_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decision_token TEXT NOT NULL UNIQUE,
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_requests_owner ON public.evidence_requests(owner_user_id);
CREATE INDEX idx_evidence_requests_cert ON public.evidence_requests(certificate_id);

GRANT SELECT, INSERT, UPDATE ON public.evidence_requests TO authenticated;
GRANT ALL ON public.evidence_requests TO service_role;

ALTER TABLE public.evidence_requests ENABLE ROW LEVEL SECURITY;

-- Owners can view requests against their own certificates
CREATE POLICY "Owners view their evidence requests"
ON public.evidence_requests
FOR SELECT
TO authenticated
USING (auth.uid() = owner_user_id);

-- All writes go through server functions using the service role; no direct
-- client INSERT/UPDATE policies are needed.

CREATE TRIGGER update_evidence_requests_updated_at
BEFORE UPDATE ON public.evidence_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();