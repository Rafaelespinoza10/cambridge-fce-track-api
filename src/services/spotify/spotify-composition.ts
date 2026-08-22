import { getDatabaseConnection } from '@lib/shared/database';
import { SpotifyService } from './spotify.service';

interface SpotifyServices {
  spotify: SpotifyService;
}

async function buildSpotifyServices(): Promise<SpotifyServices> {
  const dataSource = await getDatabaseConnection();
  return { spotify: new SpotifyService(dataSource) };
}

export { buildSpotifyServices };
export type { SpotifyServices };
