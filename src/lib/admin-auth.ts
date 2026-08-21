import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { JwtPayload } from '../interfaces/auth/auth.interface';
import { UserRole } from '../models/enums';
import { getAuthenticatedPayload } from './jwt';

/**
 * Same JWT check as getAuthenticatedPayload, plus a role gate — every
 * /admin/* handler must use this instead of getAuthenticatedPayload, so an
 * authenticated-but-non-admin user gets treated identically to an
 * unauthenticated one (null), never a distinct "authenticated but
 * forbidden" signal a caller could probe for.
 */
export function getAuthenticatedAdminPayload(event: APIGatewayProxyEvent): JwtPayload | null {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return null;
  return payload.role === UserRole.ADMIN ? payload : null;
}
