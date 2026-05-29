/**
 * releaseRadar.js — gestione playlist sorgente "_RR Source"
 *
 * Spotify blocca l'accesso API alle "Made For You" playlists (Release Radar,
 * Discover Weekly) per app senza quota extension (policy dal 27/11/2024).
 *
 * Soluzione: l'utente mantiene una sua playlist privata chiamata "Release Radar"
 * che copia manualmente dalla Release Radar ogni venerdì.
 * La PWA legge quella, genera lo snapshot, poi la svuota in background.
 *
 * NOTA endpoint Spotify (marzo 2026): /playlists/{id}/tracks è stato RIMOSSO
 * per le app in Development Mode (403). Usare sempre /playlists/{id}/items.
 */

import { spotifyFetch } from '../auth/auth.js';
import { RR_SOURCE_PLAYLIST_NAME } from '../auth/config.js';

export async function findOrCreateRRSource() {
  console.log(`[ReleaseRadar] Cerco playlist sorgente "${RR_SOURCE_PLAYLIST_NAME}"...`);

  let offset = 0;
  while (true) {
    const data = await spotifyFetch(`/me/playlists?limit=50&offset=${offset}`);
    for (const pl of (data?.items || [])) {
      if (!pl) continue;
      if (pl.name === RR_SOURCE_PLAYLIST_NAME) {
        console.log(`[ReleaseRadar] Trovata: "${pl.name}" (${pl.tracks?.total} tracce)`);
        return { id: pl.id, name: pl.name, total: pl.tracks?.total ?? 0 };
      }
    }
    if (!data.next || offset + 50 >= data.total) break;
    offset += 50;
  }

  console.log(`[ReleaseRadar] Non trovata, creo "${RR_SOURCE_PLAYLIST_NAME}"...`);
  const created = await spotifyFetch(`/me/playlists`, {
    method: 'POST',
    body: JSON.stringify({
      name: RR_SOURCE_PLAYLIST_NAME,
      public: false,
      collaborative: false,
      description: 'Playlist sorgente per Release Radar Expander. Copia qui le tracce dalla Release Radar ogni venerdì.',
    }),
  });
  console.log(`[ReleaseRadar] Playlist creata: ${created.id}`);
  return { id: created.id, name: created.name, total: 0 };
}

/**
 * Svuota la playlist sorgente (una singola chiamata PUT con array vuoto).
 * Chiamata in background dopo che lo snapshot è già stato mostrato.
 */
export async function clearRRSource(playlistId) {
  console.log(`[ReleaseRadar] Svuoto playlist sorgente ${playlistId}...`);
  await spotifyFetch(`/playlists/${playlistId}/items`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [] }),
  });
  console.log('[ReleaseRadar] Playlist sorgente svuotata.');
}

/**
 * Scarica tutte le tracce dalla playlist sorgente.
 */
export async function fetchAllPlaylistTracks(playlistId) {
  console.log('[ReleaseRadar] Scarico tracce della playlist:', playlistId);

  const tracks = [];
  let offset = 0;
  const limit = 100;

  // Spotify ha rinominato la chiave da `track` a `item` sull'endpoint /items.
  // Con la projection `fields=items(track(...))` Spotify rimappa a `track`,
  // ma per robustezza leggiamo anche `.item` come fallback.
  // Nota: album_group rimosso da Feb 2026 — non incluso nei fields.
  // Aggiunto release_date all'album (item 10: mostra la data di uscita nella vista album)
  const fields = encodeURIComponent(
    'next,total,items(track(uri,id,name,duration_ms,track_number,artists(id,name),album(id,uri,name,album_type,total_tracks,images,release_date,artists(id,name))),item(uri,id,name,duration_ms,track_number,artists(id,name),album(id,uri,name,album_type,total_tracks,images,release_date,artists(id,name))))'
  );

  while (true) {
    const data = await spotifyFetch(
      `/playlists/${playlistId}/items?limit=${limit}&offset=${offset}&fields=${fields}`
    );
    const first = data.items?.[0];
    console.log('[ReleaseRadar] Primo item raw:', JSON.stringify({
      track_uri: first?.track?.uri,
      item_uri: first?.item?.uri,
      item_keys: first ? Object.keys(first) : null,
    }));

    const normalized = (data.items || [])
      .map(it => it?.track ?? it?.item)
      .filter(t => t?.uri?.startsWith('spotify:track:'));

    tracks.push(...normalized);
    console.log(`[ReleaseRadar] Tracce caricate: ${tracks.length} / ${data.total}`);
    if (!data.next || offset + limit >= data.total) break;
    offset += limit;
  }

  console.log(`[ReleaseRadar] Totale: ${tracks.length} tracce`);
  return tracks;
}
