import type { APIGatewayProxyResult, Handler } from 'aws-lambda';

export const main: Handler = async (): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      service: 'auth',
      message: 'Cambridge Tracker API is running',
    }),
  };
};
