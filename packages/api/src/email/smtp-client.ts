/**
 * smtp-client.ts — Gmail SMTP via nodemailer, for local/dev testing.
 * Same "throw if the required env var isn't set, no silent fallback"
 * posture as jwt.ts's getJwtSecret() — invite-email.ts is the one layer
 * up that catches this and turns it into a logged, never-thrown failure.
 */
import nodemailer from 'nodemailer';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

function getSmtpUser(): string {
  const user = process.env.SMTP_USER;
  if (!user) {
    throw new Error('SMTP_USER is not set');
  }
  return user;
}

function getSmtpPassword(): string {
  const password = process.env.SMTP_PASSWORD;
  if (!password) {
    throw new Error('SMTP_PASSWORD is not set');
  }
  return password;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const user = getSmtpUser();
  const password = getSmtpPassword();
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const from = process.env.SMTP_FROM || user;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass: password },
  });

  await transporter.sendMail({ from, to: input.to, subject: input.subject, html: input.html });
}
