import * as jwt from 'jsonwebtoken';
import type { JwtPayload } from '../interfaces/auth.interface';
import type { SignOptions } from 'jsonwebtoken';

class JwtService {
  static sign(payload: JwtPayload): string {
    const secret = process.env.JWT_SECRET;
    const expiresIn = process.env.JWT_EXPIRES_IN ?? '1d';

    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }

    const options = { expiresIn } as SignOptions;
    return jwt.sign(payload, secret, options);
  }

  static verify(token: string): JwtPayload {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }

    return jwt.verify(token, secret) as JwtPayload;
  }
}

export { JwtService };
