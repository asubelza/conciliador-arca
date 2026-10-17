/**
 * invite-email.ts — backoffice self-service (invitación por email): sends
 * the "elegí tu contraseña" email via resend-client.ts. Never throws — a
 * Resend outage, or a deploy missing RESEND_API_KEY/RESEND_FROM_EMAIL/
 * APP_BASE_URL, must never roll back or block account creation (the user
 * + invite token are already committed by the time users.service.ts calls
 * this). Failures are logged and returned as {sent:false, error}, never
 * surfaced to the admin as an error on user creation itself.
 */
import { sendEmail } from '../email/resend-client';

export interface InviteEmailResult {
  sent: boolean;
  error?: string;
}

function getAppBaseUrl(): string {
  const base = process.env.APP_BASE_URL;
  if (!base) {
    throw new Error('APP_BASE_URL is not set');
  }
  return base;
}

function buildInviteUrl(rawToken: string): string {
  return `${getAppBaseUrl().replace(/\/+$/, '')}/?invite_token=${rawToken}`;
}

/**
 * display_name is admin-supplied free text (users-validation.ts only
 * checks it's a non-empty string, no character restrictions) — it must
 * never be trusted as HTML when interpolated into buildInviteHtml()'s
 * template. inviteUrl itself needs no escaping: it's built entirely from
 * trusted inputs (APP_BASE_URL, an env var, and rawToken, always
 * /^[0-9a-f]{64}$/ — neither can contain HTML metacharacters).
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInviteHtml(displayName: string | null, inviteUrl: string): string {
  const greeting = displayName ? `Hola ${escapeHtml(displayName)},` : 'Hola,';
  return [
    `<p>${greeting}</p>`,
    '<p>Te invitamos a sumarte a Conciliador ARCA. Hacé clic en el siguiente link para elegir tu contraseña:</p>',
    `<p><a href="${inviteUrl}">${inviteUrl}</a></p>`,
    '<p>Este link vence en 7 días.</p>',
  ].join('\n');
}

export async function sendInviteEmail(email: string, displayName: string | null, rawToken: string): Promise<InviteEmailResult> {
  try {
    const inviteUrl = buildInviteUrl(rawToken);
    await sendEmail({ to: email, subject: 'Invitación a Conciliador ARCA', html: buildInviteHtml(displayName, inviteUrl) });
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console -- best-effort send, this is the only record of the failure.
    console.error(`[invite-email] failed to send invite to ${email}: ${message}`);
    return { sent: false, error: message };
  }
}
