import nodemailer from "nodemailer";

export const sendWelcomeEmail = async (
  email: string,
  password: string,
  company_name: string
) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "",
      pass: "",
    },
  });

  const mailOptions = {
    from: "Trekking System <@gmail.com>",
    to: email,
    subject: "Welcome to Trekking System",
    text: `
Hello,

Your Agency "${company_name}" has been successfully registered.

Login credentials:
Email: ${email}
Password: ${password}

Please change your password after first login.

Thank you!
    `,
  };

  await transporter.sendMail(mailOptions);
};