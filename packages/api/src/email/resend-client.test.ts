import { sendEmail } from './resend-client';

/**
 * resend-client.test.ts — the only test in this PR that mocks `fetch`
 * (the genuine external boundary, same convention as the rest of this
 * repo's "never mock the DB, mock only the actual network edge" style).
 * Everything built on top of sendEmail (invite-email.ts, users.service.ts)
 * mocks this module instead of re-mocking fetch deeper down.
 */
describe('resend-client: sendEmail', () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.RESEND_FROM_EMAIL = 'no-reply@example.com';
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it('POSTs to the Resend API with the authorization header and the from/to/subject/html body', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await sendEmail({ to: 'user@example.com', subject: 'Hola', html: '<p>Hola</p>' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-resend-key', 'Content-Type': 'application/json' }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ from: 'no-reply@example.com', to: 'user@example.com', subject: 'Hola', html: '<p>Hola</p>' });
  });

  it('throws when the Resend API responds with a non-ok status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => 'invalid "to" address' });

    await expect(sendEmail({ to: 'bad', subject: 's', html: 'h' })).rejects.toThrow(/422/);
  });

  it('throws without calling fetch when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY;

    await expect(sendEmail({ to: 'user@example.com', subject: 's', html: 'h' })).rejects.toThrow('RESEND_API_KEY is not set');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws without calling fetch when RESEND_FROM_EMAIL is not set', async () => {
    delete process.env.RESEND_FROM_EMAIL;

    await expect(sendEmail({ to: 'user@example.com', subject: 's', html: 'h' })).rejects.toThrow('RESEND_FROM_EMAIL is not set');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
