/**
 * Configurazione Spotify OAuth
 * App personale — Client ID hardcoded, no Client Secret (PKCE flow)
 */

export const SPOTIFY_CLIENT_ID = 'b5bfeeaa6e8a4590bacedc11ab33387c';

export const SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ');

export const REDIRECT_URI = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:5173/callback'
  : 'https://tayri-projects.github.io/release-radar-expander/callback';

export const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

export const STORAGE_KEY = 'rr_expander_v1';

// Playlist ponte: l'utente la crea su Spotify copiando la Release Radar
// La PWA la cerca per nome tra /me/playlists (solo playlist dell'utente, nessun conflitto)
export const RR_SOURCE_PLAYLIST_NAME = 'Release Radar';
