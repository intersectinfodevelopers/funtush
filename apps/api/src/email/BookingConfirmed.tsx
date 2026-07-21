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
  Row,
  Section,
  Text,
  Column,
} from '@react-email/components';

interface Props {
  firstName: string;
  bookingId: string;
  trekName: string;
  startDate: string;
  duration: string;
  guide: string;
  itineraryPdfUrl: string;
  dashboardUrl: string;
  totalPrice: string;
}

export const BookingConfirmed = ({
  firstName,
  bookingId,
  trekName,
  startDate,
  duration,
  guide,
  itineraryPdfUrl,
  dashboardUrl,
  totalPrice,
}: Props) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img
            src="https://funtush.com/logo.png"
            width="120"
            height="40"
            alt="Funtush"
          />
        </Section>

        <Section style={content}>
          <Text style={greeting}>Hi {firstName},</Text>

          <Text style={body}>
            🎉 Your booking for <strong>{trekName}</strong> is confirmed!
          </Text>

          {/* Booking Details Card */}
          <Section style={detailsCard}>
            <Row>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Booking ID</Text>
                <Text style={detailValue}>{bookingId}</Text>
              </Column>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Total Price</Text>
                <Text style={detailValue}>{totalPrice}</Text>
              </Column>
            </Row>

            <Hr style={hr} />

            <Row>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Departure</Text>
                <Text style={detailValue}>{startDate}</Text>
              </Column>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Duration</Text>
                <Text style={detailValue}>{duration} days</Text>
              </Column>
            </Row>

            <Hr style={hr} />

            <Row>
              <Column>
                <Text style={detailLabel}>Your Guide</Text>
                <Text style={detailValue}>{guide}</Text>
              </Column>
            </Row>
          </Section>

          <Text style={body} style={{ marginTop: '24px' }}>
            Your detailed itinerary PDF is ready for download:
          </Text>

          <Button style={button} href={itineraryPdfUrl}>
            📄 Download Itinerary
          </Button>

          <Button style={buttonSecondary} href={dashboardUrl}>
            View Booking Details
          </Button>

          <Hr style={hr} />

          <Text style={subtext}>
            💡 <strong>What's next?</strong>
          </Text>
          <ul style={listStyle}>
            <li style={listItem}>
              Review the itinerary and pack accordingly
            </li>
            <li style={listItem}>
              Ensure your travel documents are valid
            </li>
            <li style={listItem}>
              You'll receive guide contact info 48 hours before departure
            </li>
            <li style={listItem}>
              Download the Funtush app for trek tracking
            </li>
          </ul>

          <Text style={body}>
            Questions? Reply to this email or contact support@funtush.com
          </Text>
        </Section>

        <Section style={footer}>
          <Text style={footerText}>
            © {new Date().getFullYear()} Funtush. All rights reserved.
          </Text>
          <Text style={footerText}>
            Sent via Funtush Trek Platform
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// Styles (reuse from InquiryReceived + new styles)
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

const detailsCard = {
  backgroundColor: '#f3f4f6',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '24px',
  marginTop: '24px',
};

const detailLabel = {
  fontSize: '12px',
  color: '#6b7280',
  fontWeight: '600',
  textTransform: 'uppercase' as const,
  marginBottom: '4px',
};

const detailValue = {
  fontSize: '16px',
  color: '#1f2937',
  fontWeight: '600',
  margin: '0',
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
  marginRight: '12px',
  marginBottom: '16px',
};

const buttonSecondary = {
  backgroundColor: '#e5e7eb',
  borderRadius: '4px',
  color: '#1f2937',
  fontSize: '14px',
  fontWeight: '600',
  padding: '12px 32px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  marginBottom: '16px',
};

const hr = {
  borderColor: '#e5e7eb',
  margin: '16px 0',
};

const subtext = {
  fontSize: '13px',
  color: '#1f2937',
  fontWeight: '600',
  marginTop: '24px',
  marginBottom: '12px',
};

const listStyle = {
  paddingLeft: '20px',
  margin: '0 0 16px 0',
};

const listItem = {
  fontSize: '14px',
  color: '#4b5563',
  marginBottom: '8px',
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