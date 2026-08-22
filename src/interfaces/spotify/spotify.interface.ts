export interface SpotifyConnectionStatusDto {
  connected: boolean;
  spotifyUserId?: string;
  scope?: string;
  connectedAt?: Date;
}

export interface SpotifyPlaylistDto {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  externalUrl: string;
  ownerName: string;
  trackCount: number;
}

export interface SpotifyShowDto {
  id: string;
  name: string;
  publisher: string;
  description: string | null;
  imageUrl: string | null;
  externalUrl: string;
}

export interface ImportSpotifyItemRequestBody {
  spotifyId: string;
  itemType: 'playlist' | 'show';
}
