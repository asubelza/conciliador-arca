import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from './jwt';

describe('T34: jwt sign/verify', () => {
  it('round-trips a valid token', () => {
    const token = signToken({ sub: 'user-1', role: 'admin', email: 'a@b.com' });
    const payload = verifyToken(token);
    expect(payload).toEqual({ sub: 'user-1', role: 'admin', email: 'a@b.com' });
  });

  it('rejects a malformed token', () => {
    expect(verifyToken('not-a-real-token')).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ sub: 'user-1', role: 'admin', email: 'a@b.com' }, 'wrong-secret');
    expect(verifyToken(forged)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ sub: 'user-1', role: 'admin', email: 'a@b.com' }, process.env.JWT_SECRET as string, {
      expiresIn: -1, // already expired
    });
    expect(verifyToken(expired)).toBeNull();
  });

  it('rejects a token whose payload has an invalid role', () => {
    const badRole = jwt.sign({ sub: 'user-1', role: 'superadmin', email: 'a@b.com' }, process.env.JWT_SECRET as string);
    expect(verifyToken(badRole)).toBeNull();
  });

  it('rejects a token missing required fields', () => {
    const incomplete = jwt.sign({ sub: 'user-1' }, process.env.JWT_SECRET as string);
    expect(verifyToken(incomplete)).toBeNull();
  });
});
