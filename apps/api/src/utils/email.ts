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
  company_name: string
) => {
  try {
    await transporter.sendMail({
      from: `"Funtush System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Welcome to Trekking System",
      text: `
Hello ${company_name},

    Your Agency "${company_name}" has been successfully registered.

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
  company_name: string
) => {
  try {
    await transporter.sendMail({
      from: `"Funtush System" < ${process.env.EMAIL_USER} > `,
      to:email,
      subject: "Trial Expired - Action Required",
      text: `
Hello ${company_name},

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
