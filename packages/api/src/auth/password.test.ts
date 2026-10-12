import { hashPassword, verifyPassword } from './password';

describe('T34: password hashing (bcryptjs)', () => {
  it('hashes a password to something that is not the plain text', async () => {
    const hash = await hashPassword('mi-contraseña-segura');
    expect(hash).not.toBe('mi-contraseña-segura');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifyPassword returns true for the correct password', async () => {
    const hash = await hashPassword('correcta123');
    await expect(verifyPassword('correcta123', hash)).resolves.toBe(true);
  });

  it('verifyPassword returns false for an incorrect password', async () => {
    const hash = await hashPassword('correcta123');
    await expect(verifyPassword('incorrecta456', hash)).resolves.toBe(false);
  });

  it('hashing the same password twice produces different hashes (random salt)', async () => {
    const [h1, h2] = await Promise.all([hashPassword('misma'), hashPassword('misma')]);
    expect(h1).not.toBe(h2);
  });
});
