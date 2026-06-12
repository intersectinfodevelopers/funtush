import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendWelcomeEmail = async (
  email: string,
  password: string,
  name: string
) => {
  try {
    await transporter.sendMail({
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
  } catch (error) {
    console.error("Email sending failed:", error);
    throw error;
  }
};

export const sendTrialExpiredEmail = async (
  email: string,
  name: string
) => {
  try {
    await transporter.sendMail({
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
  } catch (error) {
    console.error("Email sending failed:", error);
    throw error;
  }
};

export const sendOtpEmail = async (email: string, otp: string) => {
  try {
    await transporter.sendMail({
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
  } catch (error) {
    console.error("OTP email sending failed:", error);
    throw error;
  }
};

export const sendInquiryConfirmationEmail = async (
  email: string,
  trekkerName: string,
  packageTitle: string,
  departureDate: Date,
) => {
  await transporter.sendMail({
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
  await transporter.sendMail({
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
  await transporter.sendMail({
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
  await transporter.sendMail({
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
  await transporter.sendMail({
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

export const sendStaffInviteEmail = async (
  email: string,
  tempPassword: string,
  agencyName: string
) => {
  try {
    await transporter.sendMail({
      from: `"Funtush System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "You have been invited to join Funtush",
      text: `
Hello,

You have been invited to join ${agencyName} on Funtush.

Your login credentials:
  Email: ${email}
  Temporary Password: ${tempPassword}

Please log in and change your password immediately after first login.

Thank you,
Funtush Team
      `,
    });
  } catch (error) {
    console.error("Staff invite email sending failed:", error);
    throw error;
  }
};