/**
 * getReleaseRadar — trova la playlist Release Radar e scarica tutte le tracce
 *
 * Spotify non espone un endpoint dedicato "dammi la Release Radar".
 * La strategia è:
 * 1. Cercare tra le playlist dell'utente quella con nome "Release Radar"
 *    e owned da "spotify" (account ufficiale, non l'utente).
 * 2. Fallback: cercare via /search con q="Release Radar" type=playlist
 *    filtrando per owner.id === "spotify".
 *
 * Nota: Release Radar è una playlist "made for you" — appare in
 * /me/playlists solo se l'utente l'ha aggiunta alla libreria o la segue.
 * Se non la trova, istruiamo l'utente ad aggiungerla manualmente.
 */

import { spotifyFetch } from '../auth/auth.js';

/**
 * Trova l'ID della Release Radar dell'utente.
 * @returns {Promise<{id: string, name: string, snapshot_id: string} | null>}
 */
export async function findReleaseRadar() {
  console.log('[ReleaseRadar] Cerco la Release Radar nelle playlist...');

  // Pagina tutte le playlist dell'utente (max 50 per chiamata)
  let offset = 0;
  const limit = 50;

  while (true) {
    const data = await spotifyFetch(`/me/playlists?limit=${limit}&offset=${offset}`);
    console.log(`[ReleaseRadar] Playlist caricate: ${offset + data.items.length} / ${data.total}`);

    for (const playlist of data.items) {
      if (
        playlist.name === 'Release Radar' &&
        playlist.owner?.id === 'spotify'
      ) {
        console.log('[ReleaseRadar] Trovata:', playlist.id, '-', playlist.name);
        return {
          id: playlist.id,
          name: playlist.name,
          snapshot_id: playlist.snapshot_id,
        };
      }
    }

    if (data.next === null || offset + limit >= data.total) break;
    offset += limit;
  }

  // Fallback: search API
  console.log('[ReleaseRadar] Non trovata nelle playlist, provo con search...');
  try {
    const results = await spotifyFetch(
      `/search?q=Release+Radar&type=playlist&limit=10`
    );
    for (const playlist of results.playlists?.items || []) {
      if (
        playlist.name === 'Release Radar' &&
        playlist.owner?.id === 'spotify'
      ) {
        console.log('[ReleaseRadar] Trovata via search:', playlist.id);
        return {
          id: playlist.id,
          name: playlist.name,
          snapshot_id: playlist.snapshot_id,
        };
      }
    }
  } catch (e) {
    console.warn('[ReleaseRadar] Search fallback fallito:', e.message);
  }

  console.error('[ReleaseRadar] Release Radar non trovata.');
  return null;
}

/**
 * Scarica TUTTE le tracce della playlist (gestisce paginazione).
 * @param {string} playlistId
 * @returns {Promise<Array>} array di track objects Spotify (con album info)
 */
export async function fetchAllPlaylistTracks(playlistId) {
  console.log('[ReleaseRadar] Scarico tracce della playlist:', playlistId);

  const tracks = [];
  let offset = 0;
  const limit = 100; // massimo consentito da Spotify

  // Campi che ci servono — minimizza il payload
  const fields = encodeURIComponent(
    'next,total,items(track(uri,id,name,duration_ms,track_number,artists(id,name),album(id,uri,name,album_type,album_group,total_tracks,images,artists(id,name))))'
  );

  while (true) {
    const data = await spotifyFetch(
      `/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=${fields}`
    );

    const validItems = data.items.filter(
      item => item.track && item.track.uri && item.track.uri.startsWith('spotify:track:')
    );

    tracks.push(...validItems.map(item => item.track));
    console.log(`[ReleaseRadar] Tracce caricate: ${tracks.length} / ${data.total}`);

    if (data.next === null || offset + limit >= data.total) break;
    offset += limit;
  }

  console.log(`[ReleaseRadar] Totale tracce scaricate: ${tracks.length}`);
  return tracks;
}
