/**
 * getReleaseRadar — trova la playlist Release Radar e scarica tutte le tracce
 *
 * La Release Radar è una "Made For You" playlist — non appare in /me/playlists.
 * Spotify la espone tramite:
 *   GET /browse/featured-playlists  → no, sono featured generiche
 *   GET /me/playlists               → no, solo playlist seguite/create dall'utente
 *   GET /search                     → sì, ma filtrare per owner "spotify" non basta:
 *                                     i risultati possono contenere null
 *
 * Strategia corretta (in ordine di affidabilità):
 * 1. Cerca nelle "Made For You" tramite /browse/categories/0JQ5IMCbf2HKiU6CvO3i5G/playlists
 *    (categoria "Made For You" ha ID fisso su Spotify)
 * 2. Fallback: search per "Release Radar" filtrando owner.id === "spotify"
 * 3. Fallback finale: cerca tra le playlist personali con nome == "Release Radar"
 *    (alcune versioni Spotify la aggiungono automaticamente alla libreria)
 */

import { spotifyFetch } from '../auth/auth.js';

// ID categoria "Made For You" — stabile su Spotify
const MADE_FOR_YOU_CATEGORY_ID = '0JQ5IMCbf2HKiU6CvO3i5G';

/**
 * Trova l'ID della Release Radar dell'utente.
 * @returns {Promise<{id: string, name: string} | null>}
 */
export async function findReleaseRadar() {
  console.log('[ReleaseRadar] Cerco la Release Radar...');

  // --- Strategia 1: Made For You category playlists ---
  try {
    console.log('[ReleaseRadar] Strategia 1: Made For You category...');
    let offset = 0;
    const limit = 50;
    while (true) {
      const data = await spotifyFetch(
        `/browse/categories/${MADE_FOR_YOU_CATEGORY_ID}/playlists?limit=${limit}&offset=${offset}&country=IT`
      );
      const items = data?.playlists?.items || [];
      for (const pl of items) {
        if (!pl) continue;
        if (pl.name === 'Release Radar') {
          console.log('[ReleaseRadar] Trovata via Made For You:', pl.id);
          return { id: pl.id, name: pl.name };
        }
      }
      const total = data?.playlists?.total || 0;
      if (!data?.playlists?.next || offset + limit >= total) break;
      offset += limit;
    }
  } catch (e) {
    console.warn('[ReleaseRadar] Strategia 1 fallita:', e.message);
  }

  // --- Strategia 2: search API (con guard su null) ---
  try {
    console.log('[ReleaseRadar] Strategia 2: search API...');
    const results = await spotifyFetch(
      `/search?q=Release+Radar&type=playlist&limit=50`
    );
    const items = results?.playlists?.items || [];
    for (const pl of items) {
      if (!pl || !pl.owner) continue; // guard su null
      if (pl.name === 'Release Radar' && pl.owner.id === 'spotify') {
        console.log('[ReleaseRadar] Trovata via search:', pl.id);
        return { id: pl.id, name: pl.name };
      }
    }
  } catch (e) {
    console.warn('[ReleaseRadar] Strategia 2 fallita:', e.message);
  }

  // --- Strategia 3: /me/playlists (alcune versioni Spotify la sincronizzano) ---
  try {
    console.log('[ReleaseRadar] Strategia 3: /me/playlists...');
    let offset = 0;
    const limit = 50;
    while (true) {
      const data = await spotifyFetch(`/me/playlists?limit=${limit}&offset=${offset}`);
      const items = data?.items || [];
      console.log(`[ReleaseRadar] Playlist personali: ${offset + items.length} / ${data.total}`);
      for (const pl of items) {
        if (!pl) continue;
        if (pl.name === 'Release Radar') {
          console.log('[ReleaseRadar] Trovata in /me/playlists:', pl.id);
          return { id: pl.id, name: pl.name };
        }
      }
      if (!data.next || offset + limit >= data.total) break;
      offset += limit;
    }
  } catch (e) {
    console.warn('[ReleaseRadar] Strategia 3 fallita:', e.message);
  }

  console.error('[ReleaseRadar] Release Radar non trovata con nessuna strategia.');
  return null;
}

/**
 * Scarica TUTTE le tracce della playlist (gestisce paginazione).
 * @param {string} playlistId
 * @returns {Promise<Array>} array di track objects Spotify
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

    const validItems = (data.items || []).filter(
      item => item?.track?.uri?.startsWith('spotify:track:')
    );

    tracks.push(...validItems.map(item => item.track));
    console.log(`[ReleaseRadar] Tracce caricate: ${tracks.length} / ${data.total}`);

    if (!data.next || offset + limit >= data.total) break;
    offset += limit;
  }

  console.log(`[ReleaseRadar] Totale tracce scaricate: ${tracks.length}`);
  return tracks;
}
