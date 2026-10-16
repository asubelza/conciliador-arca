import { sendEmail } from '../email/resend-client';
import { sendInviteEmail } from './invite-email';

jest.mock('../email/resend-client');

/**
 * invite-email.test.ts — mocks resend-client.ts (already proven against a
 * real `fetch` mock in resend-client.test.ts), per this PR's own
 * convention: only one file mocks the genuine external boundary, everyone
 * built on top of it mocks that module instead.
 */
describe('invite-email: sendInviteEmail', () => {
  const ORIGINAL_ENV = { ...process.env };
  const sendEmailMock = sendEmail as jest.Mock;

  beforeEach(() => {
    process.env.APP_BASE_URL = 'http://localhost:3001';
    sendEmailMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('sends an email with the invite link built from APP_BASE_URL and the raw token', async () => {
    sendEmailMock.mockResolvedValue(undefined);

    const result = await sendInviteEmail('user@example.com', 'Juan', 'deadbeef');

    expect(result).toEqual({ sent: true });
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('Conciliador ARCA'),
        html: expect.stringContaining('http://localhost:3001/?invite_token=deadbeef'),
      }),
    );
  });

  it('strips a trailing slash from APP_BASE_URL before appending the query string', async () => {
    process.env.APP_BASE_URL = 'http://localhost:3001/';
    sendEmailMock.mockResolvedValue(undefined);

    await sendInviteEmail('user@example.com', null, 'cafef00d');

    const html = sendEmailMock.mock.calls[0][0].html as string;
    expect(html).toContain('http://localhost:3001/?invite_token=cafef00d');
    expect(html).not.toContain('3001//?invite_token');
  });

  it('greets generically when display_name is null', async () => {
    sendEmailMock.mockResolvedValue(undefined);

    await sendInviteEmail('user@example.com', null, 'tok');

    const html = sendEmailMock.mock.calls[0][0].html as string;
    expect(html).toContain('<p>Hola,</p>');
  });

  it('returns {sent:false, error} without throwing when sendEmail rejects (Resend outage)', async () => {
    sendEmailMock.mockRejectedValue(new Error('Resend API responded with 500: internal error'));

    const result = await sendInviteEmail('user@example.com', null, 'tok');

    expect(result).toEqual({ sent: false, error: 'Resend API responded with 500: internal error' });
  });

  it('returns {sent:false, error} without throwing when APP_BASE_URL is not set', async () => {
    delete process.env.APP_BASE_URL;

    const result = await sendInviteEmail('user@example.com', null, 'tok');

    expect(result).toEqual({ sent: false, error: 'APP_BASE_URL is not set' });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
