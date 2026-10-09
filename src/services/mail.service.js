const nodemailer = require("nodemailer");

let transporter;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
  }
  return transporter;
}

/**
 * Sends an email via SMTP when configured. Without SMTP settings the message is
 * logged to the server console (development fallback only).
 */
async function sendMail({ to, subject, text }) {
  const transport = getTransporter();
  if (!transport) {
    console.warn(`[mail] SMTP not configured. Message for ${to}:\n${subject}\n${text}`);
    return;
  }
  await transport.sendMail({
    from: process.env.MAIL_FROM || "S2Answer <no-reply@localhost>",
    to,
    subject,
    text,
  });
}

module.exports = { sendMail };
