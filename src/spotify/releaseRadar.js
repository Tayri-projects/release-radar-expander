/**
 * getReleaseRadar — trova la playlist Release Radar e scarica tutte le tracce
 *
 * La Release Radar è una "Made For You" playlist: non appare in /me/playlists.
 * L'ID è stabile per utente ma non accessibile con fields su /playlists/{id}.
 * Usiamo l'endpoint senza fields filter.
 */

import { spotifyFetch } from '../auth/auth.js';

const RELEASE_RADAR_ID = '37i9dQZEVXbhvRdPuaKypU';

export async function findReleaseRadar() {
  console.log('[ReleaseRadar] Cerco la Release Radar...');

  // --- Strategia 1: ID diretto, senza fields filter ---
  try {
    console.log('[ReleaseRadar] Strategia 1: ID diretto...');
    const pl = await spotifyFetch(`/playlists/${RELEASE_RADAR_ID}`);
    if (pl?.id) {
      console.log(`[ReleaseRadar] Trovata: "${pl.name}" (${pl.tracks?.total} tracce)`);
      return { id: pl.id, name: pl.name };
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

  // --- Strategia 3: search (limit max 20 per Spotify) ---
  try {
    console.log('[ReleaseRadar] Strategia 3: search...');
    const results = await spotifyFetch(`/search?q=Release+Radar&type=playlist&limit=20`);
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

  const fields = encodeURIComponent(
    'next,total,items(track(uri,id,name,duration_ms,track_number,artists(id,name),album(id,uri,name,album_type,album_group,total_tracks,images,artists(id,name))))'
  );

  while (true) {
    const data = await spotifyFetch(
      `/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=${fields}`
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
