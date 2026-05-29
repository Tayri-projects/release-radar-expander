/**
 * playlistWriter.js — scrittura playlist destinazione espansa + tracking sync hash
 *
 * IMPORTANTE — endpoint Spotify (migrazione Feb/Mar 2026):
 *   Da marzo 2026 l'endpoint /playlists/{id}/tracks è stato RIMOSSO per le app
 *   in Development Mode e risponde 403 Forbidden. Tutti gli endpoint sono stati
 *   rinominati in /playlists/{id}/items (GET/POST/PUT/DELETE).
 *   Il body delle request (uris: [...]) resta identico.
 *
 * Hash di sincronizzazione:
 *   Quando scriviamo la playlist destinazione, salviamo un hash (FNV-1a 32-bit)
 *   degli URI in ordine. La webapp confronta poi questo hash con quello dello
 *   snapshot corrente per decidere se la playlist su Spotify riflette lo stato
 *   atteso. Se sì, possiamo usare context_uri+offset per partire da un brano
 *   specifico senza riscrivere. Se no, riscriviamo prima.
 */

import { spotifyFetch } from '../auth/auth.js';
import {
  getExpandedPlaylistId, saveExpandedPlaylistId,
  getExpandedPlaylistHash, saveExpandedPlaylistHash,
} from '../auth/storage.js';
import { RR_SOURCE_PLAYLIST_NAME } from '../auth/config.js';

const EXPANDED_PLAYLIST_DESCRIPTION = 'Release Radar espansa — generata da Release Radar Expander. Non modificare.';

/**
 * FNV-1a 32-bit. Deterministico, veloce, output stabile in stringa hex.
 * Sufficiente per detection di cambiamenti (no requisiti crittografici).
 */
export function hashUris(uris) {
  let h = 0x811c9dc5;
  const sep = '|';
  const data = uris.join(sep);
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + ':' + uris.length;
}

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
  saveExpandedPlaylistHash(null);
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
      saveExpandedPlaylistHash(null);
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

/**
 * Verifica se la playlist destinazione su Spotify è sincronizzata con lo
 * snapshot corrente. Confronto basato sull'hash salvato in localStorage.
 *
 * @param {string[]} expectedUris - URI in ordine che ci si aspetta nella playlist
 * @returns {Promise<{synced: boolean, playlistId: string|null, currentHash: string}>}
 */
export async function checkPlaylistSync(expectedUris) {
  const currentHash = hashUris(expectedUris);
  const savedHash = getExpandedPlaylistHash();
  const playlistId = getExpandedPlaylistId();

  console.log(`[PlaylistWriter] checkPlaylistSync: current=${currentHash} saved=${savedHash} playlistId=${playlistId}`);

  if (!playlistId || !savedHash) {
    return { synced: false, playlistId: playlistId || null, currentHash };
  }
  return {
    synced: savedHash === currentHash,
    playlistId,
    currentHash,
  };
}

/**
 * Scrive (PUT vuoto + POST batch) tutti gli URI nella playlist destinazione.
 * Salva il nuovo hash di sync.
 *
 * @param {string[]} uris
 * @param {(msg: string) => void} onProgress
 * @returns {Promise<{playlistId: string, hash: string}>}
 */
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

  const hash = hashUris(uris);
  saveExpandedPlaylistHash(hash);

  console.log(`[PlaylistWriter] Playlist espansa pronta: ${uris.length} tracce, hash=${hash}`);
  return { playlistId, hash };
}

/**
 * Scrive solo se la playlist non è già sincronizzata con expectedUris.
 * Ritorna sempre {playlistId, hash, didWrite}.
 */
export async function ensurePlaylistSynced(expectedUris, onProgress = () => {}) {
  const { synced, playlistId: existingId, currentHash } = await checkPlaylistSync(expectedUris);
  if (synced) {
    console.log(`[PlaylistWriter] Playlist già sincronizzata (hash=${currentHash}). Skip scrittura.`);
    return { playlistId: existingId, hash: currentHash, didWrite: false };
  }
  console.log('[PlaylistWriter] Playlist non sincronizzata. Scrivo...');
  const { playlistId, hash } = await writeExpandedPlaylist(expectedUris, onProgress);
  return { playlistId, hash, didWrite: true };
}
