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