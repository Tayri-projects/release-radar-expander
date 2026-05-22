/**
 * playlistWriter.js — scrittura playlist destinazione espansa
 *
 * La playlist destinazione ha lo stesso nome della sorgente ("Release Radar")
 * ma è una playlist distinta creata dalla PWA.
 * La sorgente è identificata da findOrCreateRRSource() che usa la PRIMA
 * occorrenza trovata in /me/playlists.
 * La destinazione è identificata dall'ID salvato in localStorage (expanded_playlist_id).
 * Se l'ID non è ancora salvato, cerca tra le playlist dell'utente quella con
 * description = EXPANDED_PLAYLIST_DESCRIPTION, e la crea se non esiste.
 *
 * Scrittura tracce: PUT /playlists/{id}/tracks con array di URI (max 100 per batch).
 * Prima svuota con PUT uris:[], poi aggiunge in batch da 100 con POST.
 */

import { spotifyFetch } from '../auth/auth.js';
import { getExpandedPlaylistId, saveExpandedPlaylistId } from '../auth/storage.js';
import { RR_SOURCE_PLAYLIST_NAME } from '../auth/config.js';

// Descrizione univoca usata per identificare la playlist destinazione
// (il nome è uguale alla sorgente, la description la distingue)
const EXPANDED_PLAYLIST_DESCRIPTION = 'Release Radar espansa — generata da Release Radar Expander. Non modificare.';

/**
 * Trova la playlist destinazione tramite ID salvato, oppure cercandola per descrizione,
 * oppure creandola.
 * @returns {Promise<string>} ID della playlist destinazione
 */
export async function findOrCreateExpandedPlaylist() {
  // 1. Prova l'ID già salvato in localStorage
  const savedId = getExpandedPlaylistId();
  if (savedId) {
    console.log('[PlaylistWriter] ID playlist espansa trovato in localStorage:', savedId);
    // Verifica che esista ancora (potrebbe essere stata eliminata dall'utente)
    try {
      await spotifyFetch(`/playlists/${savedId}?fields=id`);
      return savedId;
    } catch (e) {
      console.warn('[PlaylistWriter] Playlist salvata non trovata, ricerco...', e.message);
      // Continua con la ricerca per descrizione
    }
  }

  // 2. Cerca tra le playlist dell'utente per description
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

  // 3. Non trovata — crea la playlist destinazione
  console.log('[PlaylistWriter] Playlist espansa non trovata, la creo...');
  const created = await spotifyFetch('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({
      name: RR_SOURCE_PLAYLIST_NAME,
      public: false,
      collaborative: false,
      description: EXPANDED_PLAYLIST_DESCRIPTION,
    }),
  });
  console.log('[PlaylistWriter] Playlist espansa creata:', created.id);
  saveExpandedPlaylistId(created.id);
  return created.id;
}

/**
 * Sovrascrive la playlist destinazione con le URI fornite.
 * Prima svuota con PUT uris:[], poi aggiunge in batch da 100 con POST.
 * @param {string[]} uris  - array di spotify:track:... URI
 * @param {function} onProgress - callback(message) per aggiornare la UI
 * @returns {Promise<string>} ID della playlist scritta
 */
export async function writeExpandedPlaylist(uris, onProgress = () => {}) {
  console.log(`[PlaylistWriter] Scrivo ${uris.length} URI nella playlist espansa...`);

  onProgress('Preparo la playlist...');
  const playlistId = await findOrCreateExpandedPlaylist();

  // Svuota la playlist
  onProgress('Svuoto la playlist...');
  console.log('[PlaylistWriter] Svuoto playlist destinazione...');
  await spotifyFetch(`/playlists/${playlistId}/tracks`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [] }),
  });

  // Aggiunge le tracce in batch da 100
  const BATCH_SIZE = 100;
  const batches = [];
  for (let i = 0; i < uris.length; i += BATCH_SIZE) {
    batches.push(uris.slice(i, i + BATCH_SIZE));
  }

  console.log(`[PlaylistWriter] Aggiunta tracce in ${batches.length} batch...`);
  for (let i = 0; i < batches.length; i++) {
    onProgress(`Aggiungo tracce ${i * BATCH_SIZE + 1}–${Math.min((i + 1) * BATCH_SIZE, uris.length)} di ${uris.length}...`);
    await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: batches[i] }),
    });
    console.log(`[PlaylistWriter] Batch ${i + 1}/${batches.length} aggiunto`);
  }

  console.log(`[PlaylistWriter] Playlist espansa pronta: ${uris.length} tracce`);
  return playlistId;
}
