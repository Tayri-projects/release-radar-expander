/**
 * getReleaseRadar — trova la playlist Release Radar e scarica tutte le tracce
 *
 * Note Feb 2026 (Spotify API breaking changes):
 * - GET /playlists/{id} per playlist non-owned (Made For You) → solo metadata, items vuoti → 404
 * - GET /playlists/{id}/items → endpoint corretto (tracks è deprecated)
 * - Search limit max = 10
 * - album_group rimosso da tutte le risposte API
 */

import { spotifyFetch } from '../auth/auth.js';

const RELEASE_RADAR_ID = '37i9dQZEVXbhvRdPuaKypU';

export async function findReleaseRadar() {
  console.log('[ReleaseRadar] Cerco la Release Radar...');

  // --- Strategia 1: /playlists/{id}/items diretto ---
  // Il nuovo endpoint /items è separato da /playlists/{id} e potrebbe funzionare
  // anche per "Made For You" (le restrizioni Feb 2026 riguardano l'oggetto playlist,
  // non necessariamente l'endpoint items).
  try {
    console.log('[ReleaseRadar] Strategia 1: /playlists/{id}/items diretto...');
    const data = await spotifyFetch(
      `/playlists/${RELEASE_RADAR_ID}/items?limit=1&fields=total`
    );
    if (typeof data?.total === 'number') {
      console.log(`[ReleaseRadar] Strategia 1 ok: ${data.total} tracce trovate via /items`);
      return { id: RELEASE_RADAR_ID, name: 'Release Radar' };
    }
  } catch (e) {
    console.warn('[ReleaseRadar] Strategia 1 fallita:', e.message);
  }

  // --- Strategia 2: /me/playlists ---
  try {
    console.log('[ReleaseRadar] Strategia 2: /me/playlists...');
    let offset = 0;
    while (true) {
      const data = await spotifyFetch(`/me/playlists?limit=50&offset=${offset}`);
      for (const pl of (data?.items || [])) {
        if (!pl) continue;
        if (pl.name === 'Release Radar') {
          console.log('[ReleaseRadar] Trovata in /me/playlists:', pl.id);
          return { id: pl.id, name: pl.name };
        }
      }
      if (!data.next || offset + 50 >= data.total) break;
      offset += 50;
    }
    console.log('[ReleaseRadar] Strategia 2: non trovata.');
  } catch (e) {
    console.warn('[ReleaseRadar] Strategia 2 fallita:', e.message);
  }

  // --- Strategia 3: search (limit max 10 da Feb 2026) ---
  try {
    console.log('[ReleaseRadar] Strategia 3: search (limit=10)...');
    const results = await spotifyFetch(`/search?q=Release+Radar&type=playlist&limit=10`);
    for (const pl of (results?.playlists?.items || [])) {
      if (!pl?.owner) continue;
      if (pl.name === 'Release Radar' && pl.owner.id === 'spotify') {
        console.log('[ReleaseRadar] Trovata via search:', pl.id);
        return { id: pl.id, name: pl.name };
      }
    }
    console.log('[ReleaseRadar] Strategia 3: non trovata.');
  } catch (e) {
    console.warn('[ReleaseRadar] Strategia 3 fallita:', e.message);
  }

  console.error('[ReleaseRadar] Release Radar non trovata con nessuna strategia.');
  return null;
}

export async function fetchAllPlaylistTracks(playlistId) {
  console.log('[ReleaseRadar] Scarico tracce della playlist:', playlistId);

  const tracks = [];
  let offset = 0;
  const limit = 100;

  // Nota: album_group rimosso da Feb 2026 — non incluso nei fields
  // Endpoint: /items (non /tracks che è deprecated)
  const fields = encodeURIComponent(
    'next,total,items(track(uri,id,name,duration_ms,track_number,artists(id,name),album(id,uri,name,album_type,total_tracks,images,artists(id,name))))'
  );

  while (true) {
    const data = await spotifyFetch(
      `/playlists/${playlistId}/items?limit=${limit}&offset=${offset}&fields=${fields}`
    );
    const valid = (data.items || []).filter(
      item => item?.track?.uri?.startsWith('spotify:track:')
    );
    tracks.push(...valid.map(i => i.track));
    console.log(`[ReleaseRadar] Tracce caricate: ${tracks.length} / ${data.total}`);
    if (!data.next || offset + limit >= data.total) break;
    offset += limit;
  }

  console.log(`[ReleaseRadar] Totale: ${tracks.length} tracce`);
  return tracks;
}
