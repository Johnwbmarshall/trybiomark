DROP VIEW IF EXISTS public.public_certificates;
CREATE VIEW public.public_certificates
WITH (security_invoker = true)
AS
SELECT certificate_id, project_name, created_at, verification_status, duration_seconds, verification_notes
FROM public.certificates;

GRANT SELECT ON public.public_certificates TO anon, authenticated, service_role;