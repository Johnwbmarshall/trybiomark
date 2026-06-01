import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

const schema = z.object({
  certificateId: z
    .string()
    .trim()
    .regex(/^CERT-[A-Z0-9-]+$/i, 'Invalid certificate id'),
  documentPdfPath: z.string().trim().min(1).max(500),
  combinedPdfPath: z.string().trim().min(1).max(500),
})

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

export const finalizeCertificate = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context

    // Update the certificate row (scoped by user via RLS).
    const { data: row, error: updateErr } = await supabase
      .from('certificates')
      .update({
        document_pdf_path: data.documentPdfPath,
        combined_pdf_path: data.combinedPdfPath,
      })
      .eq('certificate_id', data.certificateId)
      .eq('user_id', userId)
      .select('certificate_id, project_name')
      .single()

    if (updateErr || !row) {
      throw new Error(updateErr?.message ?? 'Certificate not found')
    }

    // Create a signed download URL for the combined PDF.
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('documents')
      .createSignedUrl(data.combinedPdfPath, SIGNED_URL_TTL_SECONDS, {
        download: `${row.certificate_id}.pdf`,
      })
    if (signErr || !signed?.signedUrl) {
      throw new Error(signErr?.message ?? 'Failed to create download link')
    }

    return {
      certificateId: row.certificate_id,
      projectName: row.project_name,
      downloadUrl: signed.signedUrl,
    }
  })
