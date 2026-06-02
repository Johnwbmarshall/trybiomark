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

interface EvidenceRequestProps {
  projectName?: string
  certificateId?: string
  requesterName?: string
  requesterEmail?: string
  requesterReason?: string
  decisionUrl?: string
}

const EvidenceRequestEmail = ({
  projectName,
  certificateId,
  requesterName,
  requesterEmail,
  requesterReason,
  decisionUrl,
}: EvidenceRequestProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Someone has requested the original recording for {projectName ?? 'your project'}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Evidence request</Heading>
        <Text style={text}>
          Someone verifying your certificate has asked to see the original
          evidence you submitted (screen recording, webcam video, and PDF) for{' '}
          <strong>{projectName ?? 'your project'}</strong>.
        </Text>

        <Section style={card}>
          <Text style={cardLabel}>Certificate</Text>
          <Text style={cardValue}>{certificateId ?? '—'}</Text>
          <Hr style={hr} />
          <Text style={cardLabel}>Requested by</Text>
          <Text style={cardValue}>
            {requesterName ?? 'Anonymous'} ({requesterEmail ?? 'no email'})
          </Text>
          <Hr style={hr} />
          <Text style={cardLabel}>Reason given</Text>
          <Text style={reasonValue}>{requesterReason ?? '—'}</Text>
        </Section>

        <Text style={text}>
          You decide. Approve to release time-limited download links to the
          requester, or deny to keep your recordings private. This request
          expires in 14 days.
        </Text>

        {decisionUrl ? (
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button style={button} href={decisionUrl}>
              Review request
            </Button>
          </Section>
        ) : null}

        <Text style={footer}>— The {SITE_NAME} team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: EvidenceRequestEmail,
  subject: (data: Record<string, any>) =>
    `Evidence request for ${data?.projectName ?? 'your certificate'}`,
  displayName: 'Evidence request notification',
  previewData: {
    projectName: 'Aurora — Album Cover',
    certificateId: 'CERT-2FTX-RU',
    requesterName: 'Jane Doe',
    requesterEmail: 'jane@example.com',
    requesterReason: 'Verifying authorship for an editorial submission.',
    decisionUrl: 'https://bio-mark.ca/evidence/sampletoken',
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
const cardValue = { fontSize: '15px', color: '#1c2446', margin: '0 0 10px' }
const reasonValue = {
  fontSize: '14px',
  color: '#1c2446',
  margin: '0',
  whiteSpace: 'pre-wrap' as const,
}
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
