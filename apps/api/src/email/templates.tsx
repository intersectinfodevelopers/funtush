import React from 'react';
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Row,
  Section,
  Text,
  Column,
} from '@react-email/components';

// ===== WELCOME/REGISTRATION =====
interface WelcomeProps {
  firstName: string;
  _email: string;
  verificationUrl: string;
}

export const WelcomeEmail = ({ firstName, _email, verificationUrl }: WelcomeProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting}>Welcome to Funtush, {firstName}!</Text>
          <Text style={body}>
            We're thrilled to have you join our community of adventure seekers and experienced guides.
          </Text>
          <Text style={body}>
            To get started, please verify your email address by clicking the button below:
          </Text>
          <Button style={button} href={verificationUrl}>
            Verify Email Address
          </Button>
          <Text style={subtext}>
            If you didn't create this account, please ignore this email.
          </Text>
          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// ===== KYC SUBMITTED =====
interface KYCSubmittedProps {
  firstName: string;
  submissionDate: string;
  referenceId: string;
}

export const KYCSubmittedEmail = ({ firstName, submissionDate, referenceId }: KYCSubmittedProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting}>KYC Verification Submitted</Text>
          <Text style={body}>
            Hi {firstName},
          </Text>
          <Text style={body}>
            We've received your Know Your Customer (KYC) verification documents.
          </Text>

          <Section style={detailsCard}>
            <Row>
              <Column>
                <Text style={detailLabel}>Submission Date</Text>
                <Text style={detailValue}>{submissionDate}</Text>
              </Column>
            </Row>
            <Hr style={hr} />
            <Row>
              <Column>
                <Text style={detailLabel}>Reference ID</Text>
                <Text style={detailValue}>{referenceId}</Text>
              </Column>
            </Row>
          </Section>

          <Text style={body}>
            Our team will review your documents and get back to you within 24-48 hours.
          </Text>
          <Text style={subtext}>
            You can track the status of your KYC verification in your account dashboard.
          </Text>
          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// ===== KYC APPROVED =====
interface KYCApprovedProps {
  firstName: string;
  approvalDate: string;
}

export const KYCApprovedEmail = ({ firstName, approvalDate }: KYCApprovedProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting}>KYC Verification Approved</Text>
          <Text style={body}>
            Hi {firstName},
          </Text>
          <Text style={body} style={{ color: '#059669', fontWeight: '600' }}>
            Congratulations! Your KYC verification has been approved.
          </Text>

          <Section style={detailsCard}>
            <Row>
              <Column>
                <Text style={detailLabel}>Approval Date</Text>
                <Text style={detailValue}>{approvalDate}</Text>
              </Column>
            </Row>
          </Section>

          <Text style={body}>
            You now have full access to all Funtush features and can:
          </Text>
          <ul style={listStyle}>
            <li style={listItem}>Create and publish trek listings</li>
            <li style={listItem}>Accept bookings from trekkers</li>
            <li style={listItem}>Process payments</li>
            <li style={listItem}>Access analytics and reporting</li>
          </ul>

          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// ===== KYC REJECTED =====
interface KYCRejectedProps {
  firstName: string;
  reason: string;
  resubmitUrl: string;
}

export const KYCRejectedEmail = ({ firstName, reason, resubmitUrl }: KYCRejectedProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting}>KYC Verification - Action Required</Text>
          <Text style={body}>
            Hi {firstName},
          </Text>
          <Text style={body}>
            Unfortunately, your KYC verification could not be approved at this time.
          </Text>

          <Section style={detailsCard}>
            <Row>
              <Column>
                <Text style={detailLabel}>Reason</Text>
                <Text style={detailValue}>{reason}</Text>
              </Column>
            </Row>
          </Section>

          <Text style={body}>
            Please review the reason above and resubmit your documents. Make sure:
          </Text>
          <ul style={listStyle}>
            <li style={listItem}>Documents are clear and readable</li>
            <li style={listItem}>All required fields are filled</li>
            <li style={listItem}>Information matches your account details</li>
          </ul>

          <Button style={button} href={resubmitUrl}>
            Resubmit Documents
          </Button>
          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// ===== PAYMENT CONFIRMATION + INVOICE =====
interface PaymentConfirmationProps {
  firstName: string;
  transactionId: string;
  amount: string;
  date: string;
  invoiceUrl: string;
  description: string;
}

export const PaymentConfirmationEmail = ({
  firstName,
  transactionId,
  amount,
  date,
  invoiceUrl,
  description,
}: PaymentConfirmationProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting}>Payment Confirmed</Text>
          <Text style={body}>
            Hi {firstName},
          </Text>
          <Text style={body} style={{ color: '#059669', fontWeight: '600' }}>
            Your payment has been successfully received.
          </Text>

          <Section style={detailsCard}>
            <Row>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Amount</Text>
                <Text style={detailValue}>{amount}</Text>
              </Column>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Date</Text>
                <Text style={detailValue}>{date}</Text>
              </Column>
            </Row>
            <Hr style={hr} />
            <Row>
              <Column>
                <Text style={detailLabel}>Transaction ID</Text>
                <Text style={detailValue}>{transactionId}</Text>
              </Column>
            </Row>
            <Hr style={hr} />
            <Row>
              <Column>
                <Text style={detailLabel}>Description</Text>
                <Text style={detailValue}>{description}</Text>
              </Column>
            </Row>
          </Section>

          <Button style={button} href={invoiceUrl}>
            Download Invoice
          </Button>
          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// ===== RENEWAL REMINDER =====
interface RenewalReminderProps {
  firstName: string;
  subscriptionType: string;
  expiryDate: string;
  daysRemaining: number;
  renewalUrl: string;
}

export const RenewalReminderEmail = ({
  firstName,
  subscriptionType,
  expiryDate,
  daysRemaining,
  renewalUrl,
}: RenewalReminderProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting}>Subscription Renewal Reminder</Text>
          <Text style={body}>
            Hi {firstName},
          </Text>
          <Text style={body}>
            Your {subscriptionType} subscription expires in {daysRemaining} days.
          </Text>

          <Section style={detailsCard}>
            <Row>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Subscription Type</Text>
                <Text style={detailValue}>{subscriptionType}</Text>
              </Column>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Expires On</Text>
                <Text style={detailValue}>{expiryDate}</Text>
              </Column>
            </Row>
          </Section>

          <Text style={body}>
            To avoid any service interruption, please renew your subscription now.
          </Text>
          <Button style={button} href={renewalUrl}>
            Renew Subscription
          </Button>
          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// ===== PAYMENT FAILED =====
interface PaymentFailedProps {
  firstName: string;
  amount: string;
  reason: string;
  retryUrl: string;
  attemptDate: string;
}

export const PaymentFailedEmail = ({
  firstName,
  amount,
  reason,
  retryUrl,
  attemptDate,
}: PaymentFailedProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting}>Payment Failed - Action Required</Text>
          <Text style={body}>
            Hi {firstName},
          </Text>
          <Text style={body} style={{ color: '#dc2626', fontWeight: '600' }}>
            We couldn't process your payment on {attemptDate}.
          </Text>

          <Section style={detailsCard}>
            <Row>
              <Column>
                <Text style={detailLabel}>Amount</Text>
                <Text style={detailValue}>{amount}</Text>
              </Column>
            </Row>
            <Hr style={hr} />
            <Row>
              <Column>
                <Text style={detailLabel}>Reason</Text>
                <Text style={detailValue}>{reason}</Text>
              </Column>
            </Row>
          </Section>

          <Text style={body}>
            Please update your payment method and try again to avoid service interruption.
          </Text>
          <Button style={button} href={retryUrl}>
            Retry Payment
          </Button>
          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

/// ===== BREAK-GLASS CLOSED =====
interface BreakGlassClosedProps {
  _firstName: string;           // ✅ ADD UNDERSCORE HERE
  incidentType: string;
  resolution: string;
  closedTime: string;
}

export const BreakGlassClosedEmail = ({
  _firstName,                   // ✅ CHANGE TO _firstName
  incidentType,
  resolution,
  closedTime,
}: BreakGlassClosedProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting} style={{ color: '#059669' }}>
            Emergency Resolved
          </Text>
          <Text style={body}>
            The emergency break-glass incident has been resolved.
          </Text>

          <Section style={detailsCard}>
            <Row>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Incident Type</Text>
                <Text style={detailValue}>{incidentType}</Text>
              </Column>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Closed At</Text>
                <Text style={detailValue}>{closedTime}</Text>
              </Column>
            </Row>
            <Hr style={hr} />
            <Row>
              <Column>
                <Text style={detailLabel}>Resolution</Text>
                <Text style={detailValue}>{resolution}</Text>
              </Column>
            </Row>
          </Section>

          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>

);

// ===== BUG STATUS CHANGED =====
interface BugStatusChangedProps {
  firstName: string;
  bugId: string;
  title: string;
  oldStatus: string;
  newStatus: string;
  changeTime: string;
}

export const BugStatusChangedEmail = ({
  firstName,
  bugId,
  title,
  oldStatus,
  newStatus,
  changeTime,
}: BugStatusChangedProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting}>Bug Report Status Updated</Text>
          <Text style={body}>
            Hi {firstName},
          </Text>
          <Text style={body}>
            A bug you reported has been updated.
          </Text>

          <Section style={detailsCard}>
            <Row>
              <Column>
                <Text style={detailLabel}>Bug ID</Text>
                <Text style={detailValue}>{bugId}</Text>
              </Column>
            </Row>
            <Hr style={hr} />
            <Row>
              <Column>
                <Text style={detailLabel}>Title</Text>
                <Text style={detailValue}>{title}</Text>
              </Column>
            </Row>
            <Hr style={hr} />
            <Row>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Previous Status</Text>
                <Text style={detailValue}>{oldStatus}</Text>
              </Column>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>New Status</Text>
                <Text style={detailValue}>{newStatus}</Text>
              </Column>
            </Row>
            <Hr style={hr} />
            <Row>
              <Column>
                <Text style={detailLabel}>Updated At</Text>
                <Text style={detailValue}>{changeTime}</Text>
              </Column>
            </Row>
          </Section>

          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// ===== AD CAMPAIGN APPROVED/REJECTED =====
interface AdCampaignDecisionProps {
  firstName: string;
  campaignName: string;
  status: 'APPROVED' | 'REJECTED';
  feedback?: string;
  decisionDate: string;
}

export const AdCampaignDecisionEmail = ({
  firstName,
  campaignName,
  status,
  feedback,
  decisionDate,
}: AdCampaignDecisionProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting}>
            Ad Campaign {status === 'APPROVED' ? 'Approved' : 'Rejected'}
          </Text>
          <Text style={body}>
            Hi {firstName},
          </Text>
          <Text style={body}>
            Your ad campaign has been {status === 'APPROVED' ? 'approved and is now live' : 'rejected'}.
          </Text>

          <Section style={detailsCard}>
            <Row>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Campaign Name</Text>
                <Text style={detailValue}>{campaignName}</Text>
              </Column>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Status</Text>
                <Text
                  style={detailValue}
                  style={{ color: status === 'APPROVED' ? '#059669' : '#dc2626' }}
                >
                  {status}
                </Text>
              </Column>
            </Row>
            <Hr style={hr} />
            {feedback && (
              <>
                <Row>
                  <Column>
                    <Text style={detailLabel}>Feedback</Text>
                    <Text style={detailValue}>{feedback}</Text>
                  </Column>
                </Row>
                <Hr style={hr} />
              </>
            )}
            <Row>
              <Column>
                <Text style={detailLabel}>Decision Date</Text>
                <Text style={detailValue}>{decisionDate}</Text>
              </Column>
            </Row>
          </Section>

          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// ===== SAFETY WARNING =====
interface SafetyWarningProps {
  firstName: string;
  warningType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  actionRequired: string;
  timestamp: string;
}

export const SafetyWarningEmail = ({
  firstName,
  warningType,
  severity,
  description,
  actionRequired,
  timestamp,
}: SafetyWarningProps) => {
  const severityColor = {
    LOW: '#fbbf24',
    MEDIUM: '#f97316',
    HIGH: '#ef4444',
    CRITICAL: '#991b1b',
  }[severity];

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
          </Section>

          <Section style={content}>
            <Text style={greeting} style={{ color: severityColor }}>
              Safety Warning: {warningType}
            </Text>
            <Text style={body}>
              Hi {firstName},
            </Text>
            <Text style={body}>
              We've detected a safety concern that requires your attention.
            </Text>

            <Section style={detailsCard}>
              <Row>
                <Column style={{ width: '50%' }}>
                  <Text style={detailLabel}>Severity</Text>
                  <Text style={detailValue} style={{ color: severityColor }}>
                    {severity}
                  </Text>
                </Column>
                <Column style={{ width: '50%' }}>
                  <Text style={detailLabel}>Detected At</Text>
                  <Text style={detailValue}>{timestamp}</Text>
                </Column>
              </Row>
              <Hr style={hr} />
              <Row>
                <Column>
                  <Text style={detailLabel}>Description</Text>
                  <Text style={detailValue}>{description}</Text>
                </Column>
              </Row>
              <Hr style={hr} />
              <Row>
                <Column>
                  <Text style={detailLabel}>Action Required</Text>
                  <Text style={detailValue}>{actionRequired}</Text>
                </Column>
              </Row>
            </Section>

            <Hr style={hr} />
          </Section>

          <Section style={footer}>
            <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// ===== TREK START REMINDER =====
interface TrekStartReminderProps {
  firstName: string;
  trekName: string;
  startDate: string;
  departureTime: string;
  meetingLocation: string;
  guidePhone: string;
  checklist: string[];
}

export const TrekStartReminderEmail = ({
  firstName,
  trekName,
  startDate,
  departureTime,
  meetingLocation,
  guidePhone,
  checklist,
}: TrekStartReminderProps) => (
  <Html>
    <Head />
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src="https://funtush.com/logo.png" width="120" height="40" alt="Funtush" />
        </Section>

        <Section style={content}>
          <Text style={greeting}>Trek Starting Tomorrow: {trekName}</Text>
          <Text style={body}>
            Hi {firstName},
          </Text>
          <Text style={body}>
            Your <strong>{trekName}</strong> adventure starts tomorrow!
          </Text>

          <Section style={detailsCard}>
            <Row>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Date</Text>
                <Text style={detailValue}>{startDate}</Text>
              </Column>
              <Column style={{ width: '50%' }}>
                <Text style={detailLabel}>Time</Text>
                <Text style={detailValue}>{departureTime}</Text>
              </Column>
            </Row>
            <Hr style={hr} />
            <Row>
              <Column>
                <Text style={detailLabel}>Meeting Point</Text>
                <Text style={detailValue}>{meetingLocation}</Text>
              </Column>
            </Row>
            <Hr style={hr} />
            <Row>
              <Column>
                <Text style={detailLabel}>Guide Contact</Text>
                <Text style={detailValue}>{guidePhone}</Text>
              </Column>
            </Row>
          </Section>

          <Text style={body}>Pre-Trek Checklist:</Text>
          <ul style={listStyle}>
            {checklist.map((item: string, index: number) => (
              <li key={index} style={listItem}>
                {item}
              </li>
            ))}
          </ul>

          <Text style={body}>Looking forward to seeing you on the trail!</Text>
          <Hr style={hr} />
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2024 Funtush. All rights reserved.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// ===== STYLES =====
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