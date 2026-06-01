import { supabase } from '@/integrations/supabase/client'

export interface SendTransactionalEmailParams {
  templateName: string
  recipientEmail: string
  idempotencyKey?: string
  templateData?: Record<string, unknown>
}

export async function sendTransactionalEmail(params: SendTransactionalEmailParams) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/lovable/email/transactional/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Email send failed (${res.status}): ${txt}`)
  }
  return res.json()
}
