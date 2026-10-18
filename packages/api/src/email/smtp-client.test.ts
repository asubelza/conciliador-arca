import nodemailer from 'nodemailer';
import { sendEmail } from './smtp-client';

/**
 * smtp-client.test.ts — the only test in this module that mocks
 * `nodemailer` (the genuine external boundary, same "never mock the DB,
 * mock only the actual network edge" convention as the rest of this
 * repo). Everything built on top of sendEmail (invite-email.ts) mocks
 * this module instead of re-mocking nodemailer deeper down.
 */
jest.mock('nodemailer');

describe('smtp-client: sendEmail', () => {
  const ORIGINAL_ENV = { ...process.env };
  const sendMailMock = jest.fn();
  const createTransportMock = nodemailer.createTransport as jest.Mock;

  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'test-user@gmail.com';
    process.env.SMTP_PASSWORD = 'test-app-password';
    delete process.env.SMTP_FROM;
    sendMailMock.mockReset();
    createTransportMock.mockReset();
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it('creates a transport with the host/port/auth and sends the from/to/subject/html mail', async () => {
    sendMailMock.mockResolvedValue(undefined);

    await sendEmail({ to: 'user@example.com', subject: 'Hola', html: '<p>Hola</p>' });

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: 'test-user@gmail.com', pass: 'test-app-password' },
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'test-user@gmail.com',
      to: 'user@example.com',
      subject: 'Hola',
      html: '<p>Hola</p>',
    });
  });

  it('uses secure:true when SMTP_PORT is 465 (implicit TLS)', async () => {
    process.env.SMTP_PORT = '465';
    sendMailMock.mockResolvedValue(undefined);

    await sendEmail({ to: 'user@example.com', subject: 's', html: 'h' });

    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ port: 465, secure: true }));
  });

  it('falls back to SMTP_USER as the from address when SMTP_FROM is not set', async () => {
    sendMailMock.mockResolvedValue(undefined);

    await sendEmail({ to: 'user@example.com', subject: 's', html: 'h' });

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'test-user@gmail.com' }));
  });

  it('uses SMTP_FROM as the from address when it is set', async () => {
    process.env.SMTP_FROM = 'no-reply@example.com';
    sendMailMock.mockResolvedValue(undefined);

    await sendEmail({ to: 'user@example.com', subject: 's', html: 'h' });

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'no-reply@example.com' }));
  });

  it('propagates the rejection when sendMail rejects', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP connection refused'));

    await expect(sendEmail({ to: 'user@example.com', subject: 's', html: 'h' })).rejects.toThrow('SMTP connection refused');
  });

  it('throws without calling createTransport/sendMail when SMTP_USER is not set', async () => {
    delete process.env.SMTP_USER;

    await expect(sendEmail({ to: 'user@example.com', subject: 's', html: 'h' })).rejects.toThrow('SMTP_USER is not set');
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('throws without calling createTransport/sendMail when SMTP_PASSWORD is not set', async () => {
    delete process.env.SMTP_PASSWORD;

    await expect(sendEmail({ to: 'user@example.com', subject: 's', html: 'h' })).rejects.toThrow('SMTP_PASSWORD is not set');
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
