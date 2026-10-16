/**
 * resend-client.ts — plain `fetch` call to Resend's REST API, no SDK
 * (Node 20's global fetch is enough for a single transactional send —
 * see the approved backoffice plan's reasoning for picking Resend over a
 * self-hosted SMTP server or reusing the BullMQ queue). Same "throw if the
 * required env var isn't set, no silent fallback" posture as jwt.ts's
 * getJwtSecret() — a real deploy must configure both, and a misconfigured
 * one fails loudly here. invite-email.ts is the one layer up that catches
 * this and turns it into a logged, never-thrown failure, because a
 * Resend outage must never block account creation.
 */
const RESEND_API_URL = 'https://api.resend.com/emails';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

function getResendApiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY is not set');
  }
  return key;
}

function getResendFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error('RESEND_FROM_EMAIL is not set');
  }
  return from;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getResendApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: getResendFromEmail(), to: input.to, subject: input.subject, html: input.html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API responded with ${res.status}: ${body}`);
  }
}
