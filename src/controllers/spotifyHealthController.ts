import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * Temporary bootstrap endpoint, and deliberately the only thing in this file.
 *
 * The Spotify OAuth flow has a chicken-and-egg problem: SPOTIFY_REDIRECT_URI
 * must be the deployed callback URL, registered verbatim in the Spotify
 * dashboard — but that URL only exists once the service has been deployed, and
 * the service can't be configured before it exists. So this deploys with the
 * SPOTIFY_* variables commented out (see spotify.serverless.yml), purely to
 * mint the API Gateway URL.
 *
 * No auth, no database, no imports beyond the Lambda types — so its bundle
 * stays trivial and it answers even while every other function in this service
 * is unconfigured and would throw.
 *
 * DELETE THIS, and its function entry, once the credentials are in place.
 */
export async function health(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      data: {
        service: 'cambridge-tracker-spotify',
        status: 'ok',
        configured: {
          clientId: Boolean(process.env.SPOTIFY_CLIENT_ID),
          clientSecret: Boolean(process.env.SPOTIFY_CLIENT_SECRET),
          redirectUri: process.env.SPOTIFY_REDIRECT_URI ?? null,
          tokenEncryptionKey: Boolean(process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY),
          frontendAppUrl: process.env.FRONTEND_APP_URL ?? null,
        },
      },
    }),
  };
}
