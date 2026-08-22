import * as jwt from 'jsonwebtoken';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { JwtPayload } from '../../interfaces/auth/auth.interface';
import type { SignOptions } from 'jsonwebtoken';

interface StatePayload {
  userId: string;
  purpose: string;
}

const STATE_EXPIRES_IN = '10m';

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

  static signState(payload: StatePayload): string {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }

    return jwt.sign(payload, secret, { expiresIn: STATE_EXPIRES_IN } as SignOptions);
  }

  static verifyState(token: string): StatePayload {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }

    return jwt.verify(token, secret) as StatePayload;
  }
}

export function getAuthenticatedPayload(event: APIGatewayProxyEvent): JwtPayload | null {
  const authHeader = event.headers?.['Authorization'] ?? event.headers?.['authorization'] ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    return JwtService.verify(token);
  } catch {
    return null;
  }
}

export { JwtService };
export type { StatePayload };
