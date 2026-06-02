import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'Bio Mark'

interface AppealDecisionProps {
  projectName?: string
  decision?: 'approved' | 'denied'
  reviewerNotes?: string
  certificateId?: string
  verifyUrl?: string
  downloadUrl?: string
}

const AppealDecisionEmail = ({
  projectName,
  decision,
  reviewerNotes,
  certificateId,
  verifyUrl,
  downloadUrl,
}: AppealDecisionProps) => {
  const approved = decision === 'approved'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {approved
          ? `Your Bio Mark appeal was approved — certificate issued`
          : `Your Bio Mark appeal was not approved`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {approved ? 'Your appeal was approved' : 'Your appeal was not approved'}
          </Heading>
          <Text style={text}>
            A reviewer has finished looking at the evidence you submitted for{' '}
            <strong>{projectName ?? 'your project'}</strong>.
          </Text>

          {approved ? (
            <>
              <Text style={text}>
                Your certificate has been issued. You can verify it any time at
                the link below.
              </Text>
              <Section style={card}>
                <Text style={cardLabel}>Certificate</Text>
                <Text style={cardValue}>{certificateId ?? '—'}</Text>
              </Section>
              {downloadUrl ? (
                <Section style={{ textAlign: 'center', margin: '24px 0' }}>
                  <Button style={button} href={downloadUrl}>
                    Download certified PDF
                  </Button>
                </Section>
              ) : null}
              {verifyUrl ? (
                <Text style={text}>
                  Public verification page:{' '}
                  <a href={verifyUrl}>{verifyUrl}</a>
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={text}>
              After human review the original automated decision was upheld, so
              no certificate has been issued.
            </Text>
          )}

          {reviewerNotes ? (
            <Section style={card}>
              <Text style={cardLabel}>Reviewer's notes</Text>
              <Text style={reasonValue}>{reviewerNotes}</Text>
            </Section>
          ) : null}

          <Text style={footer}>— The {SITE_NAME} team</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AppealDecisionEmail,
  subject: (data: Record<string, any>) =>
    data?.decision === 'approved'
      ? `Your Bio Mark appeal was approved`
      : `Your Bio Mark appeal was not approved`,
  displayName: 'Appeal decision (user)',
  previewData: {
    projectName: 'Aurora — Album Cover',
    decision: 'approved',
    reviewerNotes: 'Eye motion appears to be looking at second monitor; benefit of the doubt.',
    certificateId: 'CERT-2FTX-RU',
    verifyUrl: 'https://bio-mark.ca/verify/CERT-2FTX-RU',
    downloadUrl: 'https://example.com/certified.pdf',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#1c2446', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#444', lineHeight: '1.55', margin: '0 0 18px' }
const card = {
  backgroundColor: '#f7f4ea',
  border: '1px solid #e8e0c8',
  borderRadius: '8px',
  padding: '16px 18px',
  margin: '20px 0',
}
const cardLabel = {
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: '#8a7c4a',
  margin: '0 0 4px',
}
const cardValue = { fontSize: '15px', color: '#1c2446', margin: '0' }
const reasonValue = {
  fontSize: '14px',
  color: '#1c2446',
  margin: '0',
  whiteSpace: 'pre-wrap' as const,
}
const button = {
  backgroundColor: '#1c2446',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 'bold',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999', margin: '32px 0 0' }
