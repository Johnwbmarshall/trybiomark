import type { ComponentType } from 'react'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

import { template as verificationComplete } from './verification-complete'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'verification-complete': verificationComplete,
}
