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
 * Crea sempre una nuova playlist destinazione fresca.
 * Usata quando l'ID esistente risulta non modificabile (403).
 * @returns {Promise<string>} ID della nuova playlist
 */
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
    // Verifica solo che esista (GET non dà 403, è la modifica che la dà)
    try {
      await spotifyFetch(`/playlists/${savedId}?fields=id`);
      return savedId;
    } catch (e) {
      console.warn('[PlaylistWriter] Playlist salvata non trovata, invalido e ricreo:', e.message);
      saveExpandedPlaylistId(null);
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
  return createFreshExpandedPlaylist();
}

/**
 * Sovrascrive la playlist destinazione con le URI fornite.
 * Prima svuota con PUT uris:[], poi aggiunge in batch da 100 con POST.
 * Se il PUT di svuotamento risponde 403, invalida la playlist, ne crea una nuova e riprova.
 * @param {string[]} uris  - array di spotify:track:... URI
 * @param {function} onProgress - callback(message) per aggiornare la UI
 * @returns {Promise<string>} ID della playlist scritta
 */
export async function writeExpandedPlaylist(uris, onProgress = () => {}) {
  console.log(`[PlaylistWriter] Scrivo ${uris.length} URI nella playlist espansa...`);

  onProgress('Preparo la playlist...');
  let playlistId = await findOrCreateExpandedPlaylist();

  // Svuota la playlist — con retry automatico se 403
  onProgress('Svuoto la playlist...');
  console.log('[PlaylistWriter] Svuoto playlist destinazione...');
  try {
    await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [] }),
    });
  } catch (e) {
    if (e.message === 'SPOTIFY_API_ERROR_403') {
      // La playlist salvata non è modificabile — probabilmente creata con scope diversi.
      // Invalidiamo e ne creiamo una nuova fresca con il token corrente.
      console.warn('[PlaylistWriter] 403 su svuotamento — invalido playlist e ne creo una nuova...');
      saveExpandedPlaylistId(null);
      onProgress('Creo una nuova playlist...');
      playlistId = await createFreshExpandedPlaylist();
      console.log('[PlaylistWriter] Ritento svuotamento sulla nuova playlist:', playlistId);
      await spotifyFetch(`/playlists/${playlistId}/tracks`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [] }),
      });
    } else {
      throw e;
    }
  }

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
