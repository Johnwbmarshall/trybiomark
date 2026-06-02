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

interface EvidenceDecisionProps {
  projectName?: string
  certificateId?: string
  decision?: 'approved' | 'denied'
  screenUrl?: string
  webcamUrl?: string
  pdfUrl?: string
}

const EvidenceDecisionEmail = ({
  projectName,
  certificateId,
  decision,
  screenUrl,
  webcamUrl,
  pdfUrl,
}: EvidenceDecisionProps) => {
  const approved = decision === 'approved'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Your evidence request for {projectName ?? 'a certificate'} was{' '}
        {approved ? 'approved' : 'denied'}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            Request {approved ? 'approved' : 'denied'}
          </Heading>
          <Text style={text}>
            The owner of{' '}
            <strong>{projectName ?? 'the certificate'}</strong> (
            {certificateId ?? '—'}) has{' '}
            <strong>{approved ? 'approved' : 'denied'}</strong> your request to
            access the original evidence.
          </Text>

          {approved ? (
            <>
              <Text style={text}>
                Download links are valid for 7 days and are intended for the
                requester only.
              </Text>
              {screenUrl ? (
                <Section style={{ textAlign: 'center', margin: '16px 0' }}>
                  <Button style={button} href={screenUrl}>
                    Download screen recording
                  </Button>
                </Section>
              ) : null}
              {webcamUrl ? (
                <Section style={{ textAlign: 'center', margin: '16px 0' }}>
                  <Button style={button} href={webcamUrl}>
                    Download webcam recording
                  </Button>
                </Section>
              ) : null}
              {pdfUrl ? (
                <Section style={{ textAlign: 'center', margin: '16px 0' }}>
                  <Button style={button} href={pdfUrl}>
                    Download original PDF
                  </Button>
                </Section>
              ) : null}
            </>
          ) : (
            <Text style={text}>
              No materials will be shared. You may reach out to the owner
              directly through other channels if needed.
            </Text>
          )}

          <Text style={footer}>— The {SITE_NAME} team</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: EvidenceDecisionEmail,
  subject: (data: Record<string, any>) =>
    data?.decision === 'approved'
      ? `Your evidence request was approved`
      : `Your evidence request was denied`,
  displayName: 'Evidence request decision',
  previewData: {
    projectName: 'Aurora — Album Cover',
    certificateId: 'CERT-2FTX-RU',
    decision: 'approved',
    screenUrl: 'https://example.com/screen.webm',
    webcamUrl: 'https://example.com/webcam.webm',
    pdfUrl: 'https://example.com/document.pdf',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#1c2446', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#444', lineHeight: '1.55', margin: '0 0 18px' }
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
