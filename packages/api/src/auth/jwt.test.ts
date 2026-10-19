import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from './jwt';

describe('T34: jwt sign/verify', () => {
  it('round-trips a valid token', () => {
    const token = signToken({ sub: 'user-1', role: 'admin', email: 'a@b.com', estudio_id: 'estudio-1' });
    const payload = verifyToken(token);
    expect(payload).toEqual({ sub: 'user-1', role: 'admin', email: 'a@b.com', estudio_id: 'estudio-1' });
  });

  it('round-trips a valid token for a platform-level staff user (estudio_id: null)', () => {
    const token = signToken({ sub: 'user-1', role: 'admin', email: 'a@b.com', estudio_id: null });
    const payload = verifyToken(token);
    expect(payload).toEqual({ sub: 'user-1', role: 'admin', email: 'a@b.com', estudio_id: null });
  });

  it('rejects a malformed token', () => {
    expect(verifyToken('not-a-real-token')).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ sub: 'user-1', role: 'admin', email: 'a@b.com', estudio_id: 'estudio-1' }, 'wrong-secret');
    expect(verifyToken(forged)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(
      { sub: 'user-1', role: 'admin', email: 'a@b.com', estudio_id: 'estudio-1' },
      process.env.JWT_SECRET as string,
      { expiresIn: -1 }, // already expired
    );
    expect(verifyToken(expired)).toBeNull();
  });

  it('rejects a token whose payload has an invalid role', () => {
    const badRole = jwt.sign(
      { sub: 'user-1', role: 'superadmin', email: 'a@b.com', estudio_id: 'estudio-1' },
      process.env.JWT_SECRET as string,
    );
    expect(verifyToken(badRole)).toBeNull();
  });

  it('rejects a token missing required fields', () => {
    const incomplete = jwt.sign({ sub: 'user-1' }, process.env.JWT_SECRET as string);
    expect(verifyToken(incomplete)).toBeNull();
  });

  it('rejects a token whose estudio_id is neither a string nor null (e.g. a number), no silent coercion', () => {
    const badEstudioId = jwt.sign(
      { sub: 'user-1', role: 'admin', email: 'a@b.com', estudio_id: 42 },
      process.env.JWT_SECRET as string,
    );
    expect(verifyToken(badEstudioId)).toBeNull();
  });

  it('rejects a token missing estudio_id entirely (undefined does not satisfy string | null)', () => {
    const missingEstudioId = jwt.sign({ sub: 'user-1', role: 'admin', email: 'a@b.com' }, process.env.JWT_SECRET as string);
    expect(verifyToken(missingEstudioId)).toBeNull();
  });
});
