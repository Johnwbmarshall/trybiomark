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

interface VerificationCompleteProps {
  projectName?: string
  certificateId?: string
  downloadUrl?: string
  verifyUrl?: string
}

const VerificationCompleteEmail = ({
  projectName,
  certificateId,
  downloadUrl,
  verifyUrl,
}: VerificationCompleteProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Your {SITE_NAME} certificate {certificateId ?? ''} is ready
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your certificate is ready</Heading>
        <Text style={text}>
          The verification for{' '}
          <strong>{projectName ?? 'your project'}</strong> is complete. We've
          appended the signed Certificate of Authenticity to your original
          document.
        </Text>

        {certificateId ? (
          <Section style={idBlock}>
            <Text style={idLabel}>Certificate ID</Text>
            <Text style={idValue}>{certificateId}</Text>
          </Section>
        ) : null}

        {downloadUrl ? (
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button style={button} href={downloadUrl}>
              Download your certified PDF
            </Button>
            <Text style={hint}>
              This secure link is valid for 30 days and only you can access it.
            </Text>
          </Section>
        ) : null}

        {verifyUrl ? (
          <Text style={text}>
            Anyone can verify your certificate at:{' '}
            <a href={verifyUrl} style={link}>
              {verifyUrl}
            </a>
          </Text>
        ) : null}

        <Text style={footer}>— The {SITE_NAME} team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: VerificationCompleteEmail,
  subject: (data: Record<string, any>) =>
    `Your ${SITE_NAME} certificate ${data?.certificateId ?? ''} is ready`.trim(),
  displayName: 'Verification complete',
  previewData: {
    projectName: 'Aurora — Album Cover',
    certificateId: 'CERT-2FTX-RU',
    downloadUrl: 'https://example.com/download/sample.pdf',
    verifyUrl: 'https://bio-mark.ca/verify/CERT-2FTX-RU',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#1c2446',
  margin: '0 0 20px',
}
const text = {
  fontSize: '15px',
  color: '#444',
  lineHeight: '1.55',
  margin: '0 0 18px',
}
const idBlock = {
  backgroundColor: '#f7f4ea',
  border: '1px solid #e8e0c8',
  borderRadius: '8px',
  padding: '14px 18px',
  margin: '20px 0',
}
const idLabel = {
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: '#8a7c4a',
  margin: '0 0 4px',
}
const idValue = {
  fontFamily: 'Courier, monospace',
  fontSize: '20px',
  color: '#1c2446',
  margin: 0,
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
const hint = { fontSize: '12px', color: '#888', margin: '12px 0 0' }
const link = { color: '#1c2446' }
const footer = { fontSize: '12px', color: '#999', margin: '32px 0 0' }
