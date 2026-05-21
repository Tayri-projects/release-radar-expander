/**
 * getReleaseRadar — trova la playlist Release Radar e scarica tutte le tracce
 *
 * La Release Radar è una "Made For You" playlist generata da Spotify.
 * Non appare in /me/playlists come playlist normali.
 *
 * Strategia definitiva (più robusta):
 * 1. Prova a leggere direttamente l'ID noto dell'utente (hardcoded dopo discovery).
 * 2. Se non funziona (token insufficiente, playlist rimossa), cerca via
 *    /me/playlists e search come fallback.
 *
 * ID Release Radar dell'utente: 37i9dQZEVXbhvRdPuaKypU
 * (ricavato dal link https://open.spotify.com/playlist/37i9dQZEVXbhvRdPuaKypU)
 *
 * NOTA: questo ID è stabile per un dato utente — Spotify non lo rigenera.
 */

import { spotifyFetch } from '../auth/auth.js';

// ID Release Radar dell'utente (da open.spotify.com/playlist/...)
const RELEASE_RADAR_ID = '37i9dQZEVXbhvRdPuaKypU';

/**
 * Trova la Release Radar. Prima prova l'ID diretto, poi fallback dinamici.
 * @returns {Promise<{id: string, name: string} | null>}
 */
export async function findReleaseRadar() {
  console.log('[ReleaseRadar] Cerco la Release Radar...');

  // --- Strategia 1: ID diretto (hardcoded) ---
  try {
    console.log('[ReleaseRadar] Strategia 1: accesso diretto per ID...');
    const pl = await spotifyFetch(
      `/playlists/${RELEASE_RADAR_ID}?fields=id,name,owner,snapshot_id,tracks.total`
    );
    if (pl?.id) {
      console.log(`[ReleaseRadar] Trovata: "${pl.name}" (${pl.tracks.total} tracce)`);
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
  } catch (e) {
    console.warn('[ReleaseRadar] Strategia 2 fallita:', e.message);
  }

  // --- Strategia 3: search API ---
  try {
    console.log('[ReleaseRadar] Strategia 3: search...');
    const results = await spotifyFetch(`/search?q=Release+Radar&type=playlist&limit=50`);
    for (const pl of (results?.playlists?.items || [])) {
      if (!pl?.owner) continue;
      if (pl.name === 'Release Radar' && pl.owner.id === 'spotify') {
        console.log('[ReleaseRadar] Trovata via search:', pl.id);
        return { id: pl.id, name: pl.name };
      }
    }
  } catch (e) {
    console.warn('[ReleaseRadar] Strategia 3 fallita:', e.message);
  }

  console.error('[ReleaseRadar] Release Radar non trovata.');
  return null;
}

/**
 * Scarica TUTTE le tracce della playlist (gestisce paginazione).
 * @param {string} playlistId
 * @returns {Promise<Array>}
 */
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
