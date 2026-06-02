import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'Bio Mark'

interface Check {
  label?: string
  passed?: boolean
  confidence?: string
  reason?: string
}

interface AppealSubmittedProps {
  projectName?: string
  userEmail?: string
  userNote?: string
  geminiSummary?: string
  checks?: Check[]
  reviewUrl?: string
  screenUrl?: string
  webcamUrl?: string
  pdfUrl?: string
}

const AppealSubmittedEmail = ({
  projectName,
  userEmail,
  userNote,
  geminiSummary,
  checks,
  reviewUrl,
  screenUrl,
  webcamUrl,
  pdfUrl,
}: AppealSubmittedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      New verification appeal for {projectName ?? 'a Bio Mark project'}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Verification appeal to review</Heading>
        <Text style={text}>
          A user has appealed an automated denial for{' '}
          <strong>{projectName ?? 'their project'}</strong>. You can review the
          full evidence and either reverse the decision (which issues the
          certificate) or uphold it.
        </Text>

        <Section style={card}>
          <Text style={cardLabel}>Submitted by</Text>
          <Text style={cardValue}>{userEmail ?? 'unknown'}</Text>
          {userNote ? (
            <>
              <Hr style={hr} />
              <Text style={cardLabel}>User's note</Text>
              <Text style={reasonValue}>{userNote}</Text>
            </>
          ) : null}
          <Hr style={hr} />
          <Text style={cardLabel}>Gemini summary</Text>
          <Text style={reasonValue}>{geminiSummary ?? '—'}</Text>
        </Section>

        {checks && checks.length ? (
          <Section style={{ margin: '16px 0' }}>
            <Text style={cardLabel}>Gemini checks</Text>
            {checks.map((c, i) => (
              <Text key={i} style={checkLine}>
                <strong>{c.passed ? '✓' : '✗'} {c.label}</strong>
                {c.confidence ? ` — ${c.confidence} confidence` : ''}
                {c.reason ? `: ${c.reason}` : ''}
              </Text>
            ))}
          </Section>
        ) : null}

        <Section style={{ margin: '20px 0' }}>
          <Text style={cardLabel}>Evidence (signed, 7-day links)</Text>
          {screenUrl ? (
            <Text style={linkLine}>
              Screen recording: <a href={screenUrl}>{screenUrl}</a>
            </Text>
          ) : null}
          {webcamUrl ? (
            <Text style={linkLine}>
              Webcam recording: <a href={webcamUrl}>{webcamUrl}</a>
            </Text>
          ) : null}
          {pdfUrl ? (
            <Text style={linkLine}>
              Original PDF: <a href={pdfUrl}>{pdfUrl}</a>
            </Text>
          ) : null}
        </Section>

        {reviewUrl ? (
          <Section style={{ textAlign: 'center', margin: '28px 0' }}>
            <Button style={button} href={reviewUrl}>
              Open review page
            </Button>
          </Section>
        ) : null}

        <Text style={footer}>— The {SITE_NAME} system</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: AppealSubmittedEmail,
  subject: (data: Record<string, any>) =>
    `Appeal: ${data?.projectName ?? 'Bio Mark project'}`,
  displayName: 'Appeal submitted (reviewer)',
  previewData: {
    projectName: 'Aurora — Album Cover',
    userEmail: 'creator@example.com',
    userNote: 'My eyes drifted because I was reading my own notes on paper.',
    geminiSummary: 'Webcam shows frequent off-screen glances during typing.',
    checks: [
      { label: 'No transcription', passed: false, confidence: 'medium', reason: 'Off-screen gazes correlated with typing.' },
    ],
    reviewUrl: 'https://bio-mark.ca/appeals/sampletoken',
    screenUrl: 'https://example.com/screen.webm',
    webcamUrl: 'https://example.com/webcam.webm',
    pdfUrl: 'https://example.com/doc.pdf',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '600px' }
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
const cardValue = { fontSize: '15px', color: '#1c2446', margin: '0 0 10px' }
const reasonValue = {
  fontSize: '14px',
  color: '#1c2446',
  margin: '0',
  whiteSpace: 'pre-wrap' as const,
}
const checkLine = { fontSize: '13px', color: '#1c2446', margin: '6px 0' }
const linkLine = { fontSize: '13px', color: '#1c2446', margin: '4px 0', wordBreak: 'break-all' as const }
const hr = { borderColor: '#e8e0c8', margin: '10px 0' }
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
