import React from 'react';
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Section,
  Text,
} from '@react-email/components';

interface Props {
  firstName: string;
  trekName: string;
  inquiryId: string;
  trackingUrl: string;
}

export const InquiryReceived = ({
  firstName,
  trekName,
  inquiryId,
  trackingUrl,
}: Props) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        {/* Header */}
        <Section style={header}>
          <Img
            src="https://funtush.com/logo.png"
            width="120"
            height="40"
            alt="Funtush"
          />
        </Section>

        {/* Main Content */}
        <Section style={content}>
          <Text style={greeting}>Hi {firstName},</Text>

          <Text style={body}>
            Thank you for your interest in <strong>{trekName}</strong>! We've
            received your inquiry and our team is reviewing your details.
          </Text>

          <Text style={body}>
            <strong>Inquiry ID:</strong> {inquiryId}
          </Text>

          <Button style={button} href={trackingUrl}>
            Track Your Inquiry
          </Button>

          <Hr style={hr} />

          <Text style={subtext}>
            You'll hear back from us within 24 hours with personalized trek
            details and pricing.
          </Text>
        </Section>

        {/* Footer */}
        <Section style={footer}>
          <Text style={footerText}>
            © {new Date().getFullYear()} Funtush. All rights reserved.
          </Text>
          <Text style={footerText}>
            <Link href="https://funtush.com/contact" style={footerLink}>
              Contact Us
            </Link>
            {' • '}
            <Link href="https://funtush.com/faq" style={footerLink}>
              FAQ
            </Link>
            {' • '}
            <Link href="https://funtush.com/privacy" style={footerLink}>
              Privacy
            </Link>
          </Text>
          <Text style={footerText}>Sent via Funtush Trek Platform</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// Styles
const main = {
  backgroundColor: '#f9fafb',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  marginBottom: '64px',
  padding: '20px 0 48px',
  marginTop: '8px',
  borderRadius: '8px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
};

const header = {
  padding: '32px 20px',
  textAlign: 'center' as const,
  borderBottom: '1px solid #e5e7eb',
};

const content = {
  padding: '32px 20px',
};

const greeting = {
  fontSize: '20px',
  fontWeight: '600',
  color: '#1f2937',
  marginBottom: '16px',
};

const body = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#4b5563',
  marginBottom: '16px',
};

const button = {
  backgroundColor: '#059669',
  borderRadius: '4px',
  color: '#fff',
  fontSize: '14px',
  fontWeight: '600',
  padding: '12px 32px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  marginTop: '16px',
  marginBottom: '16px',
};

const hr = {
  borderColor: '#e5e7eb',
  margin: '32px 0',
};

const subtext = {
  fontSize: '13px',
  color: '#6b7280',
  lineHeight: '1.5',
};

const footer = {
  padding: '20px',
  borderTop: '1px solid #e5e7eb',
  textAlign: 'center' as const,
};

const footerText = {
  fontSize: '12px',
  color: '#6b7280',
  margin: '4px 0',
};

const footerLink = {
  color: '#059669',
  textDecoration: 'none',
};