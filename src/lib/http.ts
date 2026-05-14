import type { APIGatewayProxyResult } from 'aws-lambda';

export const ok = (body: Record<string, unknown>): APIGatewayProxyResult => ({
  statusCode: 200,
  body: JSON.stringify(body),
});

export const created = (body: Record<string, unknown>): APIGatewayProxyResult => ({
  statusCode: 201,
  body: JSON.stringify(body),
});

export const notFound = (message = 'Not found'): APIGatewayProxyResult => ({
  statusCode: 404,
  body: JSON.stringify({ success: false, message }),
});

export const badRequest = (message = 'Bad request'): APIGatewayProxyResult => ({
  statusCode: 400,
  body: JSON.stringify({ success: false, message }),
});
