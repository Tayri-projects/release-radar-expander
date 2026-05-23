/**
 * playlistWriter.js — scrittura playlist destinazione espansa
 *
 * IMPORTANTE — endpoint Spotify (migrazione Feb/Mar 2026):
 *   Da marzo 2026 l'endpoint /playlists/{id}/tracks è stato RIMOSSO per le app
 *   in Development Mode e risponde 403 Forbidden. Tutti gli endpoint sono stati
 *   rinominati in /playlists/{id}/items (GET/POST/PUT/DELETE).
 *   Il body delle request (uris: [...]) resta identico.
 */

import { spotifyFetch } from '../auth/auth.js';
import { getExpandedPlaylistId, saveExpandedPlaylistId } from '../auth/storage.js';
import { RR_SOURCE_PLAYLIST_NAME } from '../auth/config.js';

const EXPANDED_PLAYLIST_DESCRIPTION = 'Release Radar espansa — generata da Release Radar Expander. Non modificare.';

async function createFreshExpandedPlaylist() {
  console.log('[PlaylistWriter] Creo una nuova playlist espansa...');
  const created = await spotifyFetch('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({
      name: RR_SOURCE_PLAYLIST_NAME,
      public: false,
      collaborative: false,
      description: EXPANDED_PLAYLIST_DESCRIPTION,
    }),
  });
  console.log('[PlaylistWriter] Nuova playlist espansa creata:', created.id);
  saveExpandedPlaylistId(created.id);
  return created.id;
}

export async function findOrCreateExpandedPlaylist() {
  const savedId = getExpandedPlaylistId();
  if (savedId) {
    console.log('[PlaylistWriter] ID playlist espansa trovato in localStorage:', savedId);
    try {
      await spotifyFetch(`/playlists/${savedId}?fields=id`);
      return savedId;
    } catch (e) {
      console.warn('[PlaylistWriter] Playlist salvata non trovata, invalido e ricreo:', e.message);
      saveExpandedPlaylistId(null);
    }
  }

  console.log('[PlaylistWriter] Cerco playlist espansa per descrizione...');
  let offset = 0;
  while (true) {
    const data = await spotifyFetch(`/me/playlists?limit=50&offset=${offset}`);
    for (const pl of (data?.items || [])) {
      if (!pl) continue;
      if (
        pl.name === RR_SOURCE_PLAYLIST_NAME &&
        pl.description === EXPANDED_PLAYLIST_DESCRIPTION
      ) {
        console.log('[PlaylistWriter] Playlist espansa trovata per descrizione:', pl.id);
        saveExpandedPlaylistId(pl.id);
        return pl.id;
      }
    }
    if (!data.next || offset + 50 >= data.total) break;
    offset += 50;
  }

  return createFreshExpandedPlaylist();
}

export async function writeExpandedPlaylist(uris, onProgress = () => {}) {
  console.log(`[PlaylistWriter] Scrivo ${uris.length} URI nella playlist espansa (endpoint /items)...`);

  onProgress('Preparo la playlist...');
  const playlistId = await findOrCreateExpandedPlaylist();

  onProgress('Svuoto la playlist...');
  console.log('[PlaylistWriter] Svuoto playlist destinazione:', playlistId);
  await spotifyFetch(`/playlists/${playlistId}/items`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [] }),
  });

  const BATCH_SIZE = 100;
  const batches = [];
  for (let i = 0; i < uris.length; i += BATCH_SIZE) {
    batches.push(uris.slice(i, i + BATCH_SIZE));
  }

  console.log(`[PlaylistWriter] Aggiunta tracce in ${batches.length} batch...`);
  for (let i = 0; i < batches.length; i++) {
    onProgress(`Aggiungo tracce ${i * BATCH_SIZE + 1}-${Math.min((i + 1) * BATCH_SIZE, uris.length)} di ${uris.length}...`);
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: batches[i] }),
    });
    console.log(`[PlaylistWriter] Batch ${i + 1}/${batches.length} aggiunto`);
  }

  console.log(`[PlaylistWriter] Playlist espansa pronta: ${uris.length} tracce`);
  return playlistId;
}
