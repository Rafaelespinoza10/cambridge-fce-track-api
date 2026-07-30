import type { APIGatewayProxyResult } from 'aws-lambda';

export const successResponse = (
  body: Record<string, unknown>,
  statusCode = 200,
): APIGatewayProxyResult => ({
  statusCode,
  body: JSON.stringify(body),
});

export const errorResponse = (
  message: string,
  statusCode = 500,
): APIGatewayProxyResult => ({
  statusCode,
  body: JSON.stringify({ success: false, message }),
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function handleError(err: unknown): APIGatewayProxyResult {
  const error = err as { message?: string; statusCode?: number };
  const status = error.statusCode ?? 500;
  const message = status < 500 ? (error.message ?? 'Error') : 'Internal server error';
  return errorResponse(message, status);
}
