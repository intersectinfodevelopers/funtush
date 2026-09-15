import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Every function below is a fire-and-forget notification sent *after* the
 * state change it describes has already committed to the database (a
 * booking already exists, a staff account was already created, an OTP was
 * already stored in Redis). None of them has a legitimate reason to block
 * or fail the request that triggered it — a Gmail SMTP hiccup, or simply
 * `EMAIL_USER`/`EMAIL_PASS` not being configured (any local/staging/CI
 * environment, this test suite included), should not mean an agency can't
 * accept a booking or a trekker can't submit an inquiry.
 *
 * Previously some of these functions re-threw after logging and some had
 * no try/catch at all — either way, `sendMail` rejecting propagated
 * straight to the caller and aborted the booking/staff/OTP flow that
 * called it. All 12 now share one shape: try, log on failure, never throw.
 */
/**
 * Skips the real SMTP connection entirely when unconfigured, rather than
 * attempting (and paying the real network round-trip for) a Gmail TLS
 * handshake that can only fail on auth — the same "not configured, running
 * in mock mode" convention `lib/emailQueue.ts`/`emailService.ts` already
 * use elsewhere in this codebase, applied here too.
 */
async function send(subject: string, mail: Parameters<typeof transporter.sendMail>[0]): Promise<void> {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn(`[EMAIL] EMAIL_USER/EMAIL_PASS not configured — skipping (${subject}) to ${String(mail.to)}`);
    return;
  }
  try {
    await transporter.sendMail(mail);
  } catch (error) {
    console.error(`Email sending failed (${subject}):`, error);
  }
}

export const sendStaffInviteEmail = async (
  email: string,
  tempPassword: string,
  agencyId: string
) => {
  await send("staff invite", {
    from: `"Funtush System" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "You've been added to an agency on Funtush",
    text: `
Hello,

A staff account has been created for you on Funtush (agency ${agencyId}).

Login credentials:
Email: ${email}
Temporary password: ${tempPassword}

Please sign in and change your password immediately.

Thank you!
      `,
  });
};

export const sendWelcomeEmail = async (
  email: string,
  password: string,
  name: string
) => {
  await send("welcome", {
    from: `"Funtush System" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Welcome to Trekking System",
    text: `
Hello ${name},

    Your Agency "${name}" has been successfully registered.

Login credentials:
Email: ${email}
Password: ${password}

Please change your password after first login.

Thank you!
      `,
  });
};

export const sendTrialExpiredEmail = async (
  email: string,
  name: string
) => {
  await send("trial expired", {
    from: `"Funtush System" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Trial Expired - Action Required",
    text: `
Hello ${name},

Your free trial has expired and your account is now LOCKED.

To continue using the system, please upgrade your subscription.

If you believe this is a mistake, please contact support.

Thank you,
Funtush Team
      `,
  });
};

export const sendOtpEmail = async (email: string, otp: string) => {
  await send("OTP", {
    from: `"Trekking System" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your OTP Code",
    text: `
Hello,

Your verification code is: ${otp}

This code will expire in 15 minutes.

Thank you!
      `,
  });
};

export const sendInquiryConfirmationEmail = async (
  email: string,
  trekkerName: string,
  packageTitle: string,
  departureDate: Date,
) => {
  await send("inquiry confirmation", {
    from: `"Funtush" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your inquiry has been submitted",
    text: `
Hi ${trekkerName},

Your inquiry for "${packageTitle}" (departing ${departureDate.toDateString()}) has been submitted.

The agency will confirm within 24 hours.

Thank you!
    `,
  });
};

export const sendAgencyInquiryAlertEmail = async (
  agencyEmail: string,
  trekkerName: string,
  packageTitle: string,
  bookingId: string,
) => {
  await send("agency inquiry alert", {
    from: `"Funtush" <${process.env.EMAIL_USER}>`,
    to: agencyEmail,
    subject: `New Inquiry from ${trekkerName}`,
    text: `
You have a new inquiry.

Trekker: ${trekkerName}
Package: ${packageTitle}
Booking ID: ${bookingId}

Please log in to your dashboard to review and respond.
    `,
  });
};

export const sendBookingAcceptedEmail = async (
  email: string,
  trekkerName: string,
  packageTitle: string,
  paymentLink: string,
  expiresAt: Date,
) => {
  await send("booking accepted", {
    from: `"Funtush" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your booking has been confirmed!",
    text: `
Hi ${trekkerName},

Great news! Your booking for "${packageTitle}" has been confirmed.

Please complete your payment within 48 hours using the link below:
${paymentLink}

Payment link expires: ${expiresAt.toDateString()}

Thank you!
    `,
  });
};

export const sendBookingRejectedEmail = async (
  email: string,
  trekkerName: string,
  packageTitle: string,
  reason: string,
) => {
  await send("booking rejected", {
    from: `"Funtush" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Update on your booking inquiry",
    text: `
Hi ${trekkerName},

Unfortunately your inquiry for "${packageTitle}" could not be accepted.

Reason: ${reason}

You're welcome to browse other available packages.

Thank you,
Funtush Team
    `,
  });
};

export const sendAlternativeDateEmail = async (
  email: string,
  trekkerName: string,
  packageTitle: string,
  proposedDate: Date,
) => {
  await send("alternative date proposed", {
    from: `"Funtush" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Alternative date proposed for your booking",
    text: `
Hi ${trekkerName},

The agency has proposed an alternative departure date for "${packageTitle}".

Proposed date: ${proposedDate.toDateString()}

Please log in to your dashboard to accept or decline.

Thank you,
Funtush Team
    `,
  });
};

export const sendBookingConfirmationEmail = async (
  trekkerEmail: string,
  trekkerName: string,
  packageTitle: string,
  departureDate: Date,
  bookingId: string,
  guideName: string | null,
  pdfBuffer: Buffer
) => {
  await send("booking confirmation", {
    from: `"Funtush" <${process.env.EMAIL_USER}>`,
    to: trekkerEmail,
    subject: `Booking Confirmed — ${packageTitle}`,
    text: `
Hi ${trekkerName},

Your payment has been received and your booking is confirmed!

Package: ${packageTitle}
Departure: ${departureDate.toDateString()}
Booking ID: ${bookingId}
${guideName ? `Assigned Guide: ${guideName}` : "Your guide will be assigned shortly and you will be notified."}

Please find your full booking confirmation and itinerary attached as a PDF.

Safe trekking!
Funtush Team
    `.trim(),
    attachments: [
      {
        filename: `booking-confirmation-${bookingId}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
};

export const sendGuideAssignmentEmail = async (
  guideEmail: string,
  guideName: string,
  packageTitle: string,
  departureDate: Date,
  trekkerName: string,
  trekkerPhone: string,
  trekkerCountry: string | null,
  groupSize: number,
  bookingId: string
) => {
  await send("guide assignment", {
    from: `"Funtush" <${process.env.EMAIL_USER}>`,
    to: guideEmail,
    subject: `Trek Assignment — ${packageTitle}`,
    text: `
Hi ${guideName},

You have been assigned to lead a trek.

Package: ${packageTitle}
Departure: ${departureDate.toDateString()}
Booking ID: ${bookingId}

Trekker Details:
  Name: ${trekkerName}
  Phone: ${trekkerPhone}
  Country: ${trekkerCountry ?? "Not specified"}
  Group Size: ${groupSize}

Please prepare accordingly and contact the trekker if needed before the departure date.

Thank you,
Funtush Team
    `.trim(),
  });
};

export const sendReviewInvitationEmail = async (
  email: string,
  name: string,
  invitationLink: string,
) => {
  await send("review invitation", {
    from: `"Funtush System" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Review Invitation - Share Your Trek Experience",
    html: `
      <h2>Hello ${name},</h2>

      <p>
        Congratulations on completing your trek.
      </p>

      <p>
        We'd love to hear about your experience.
      </p>

      <a href="${invitationLink}">
        Leave Review
      </a>

      <p>
        Thank you for choosing Funtush.
      </p>
    `,
  });
};
