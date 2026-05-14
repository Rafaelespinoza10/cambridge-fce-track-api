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
