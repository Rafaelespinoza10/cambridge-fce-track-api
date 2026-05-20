import 'reflect-metadata';
import { errorResponse, successResponse } from '@lib/response';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { LoginBody, RegisterBody } from '../interfaces/auth.interface';
import { AuthService } from '../services/auth.service';

const service = new AuthService();

export async function login(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: LoginBody;

  try {
    body = JSON.parse(event.body ?? '{}') as LoginBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const result = await service.login(body);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    const error = err as { message?: string; statusCode?: number };
    const status = error.statusCode ?? 500;
    const message = status < 500 ? (error.message ?? 'Error') : 'Internal server error';
    return errorResponse(message, status);
  }
}

export async function register(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: RegisterBody;

  try {
    body = JSON.parse(event.body ?? '{}') as RegisterBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const result = await service.register(body);
    return successResponse({ success: true, data: result }, 201);
  } catch (err: unknown) {
    const error = err as { message?: string; statusCode?: number };
    const status = error.statusCode ?? 500;
    const message = status < 500 ? (error.message ?? 'Error') : 'Internal server error';
    return errorResponse(message, status);
  }
}

export async function me(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const authHeader =
    event.headers?.['Authorization'] ?? event.headers?.['authorization'] ?? '';

  if (!authHeader.startsWith('Bearer ')) {
    return errorResponse('Missing or invalid Authorization header', 401);
  }

  const token = authHeader.slice(7);

  try {
    const result = await service.getMe(token);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    const error = err as { message?: string; statusCode?: number };
    const status = error.statusCode ?? 500;
    const message = status < 500 ? (error.message ?? 'Error') : 'Internal server error';
    return errorResponse(message, status);
  }
}
