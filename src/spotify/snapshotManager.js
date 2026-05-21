/**
 * snapshotManager.js — lifecycle snapshot settimanale
 *
 * Logica all'apertura:
 *
 * Esiste snapshot settimana corrente in localStorage?
 * ├── SÌ  → restituisce quello, fine (non tocca la playlist sorgente)
 * └── NO  → leggi playlist sorgente
 *           ├── Ha tracce → genera snapshot → salva → restituisce (mostra UI)
 *           │              → [background] svuota playlist sorgente
 *           └── Vuota/errore → lancia RR_SOURCE_EMPTY
 */

import { findOrCreateRRSource, fetchAllPlaylistTracks, clearRRSource } from './releaseRadar.js';
import { buildSnapshot, getCurrentWeekKey } from './expander.js';
import { getSnapshot, saveSnapshot } from '../auth/storage.js';

/**
 * Carica lo snapshot della settimana corrente, creandolo se necessario.
 * @param {function} onProgress - callback(message) per aggiornare la UI
 * @returns {Promise<{snapshot, weekKey, fromCache}>}
 */
export async function loadOrCreateCurrentSnapshot(onProgress = () => {}) {
  const weekKey = getCurrentWeekKey();

  // Cache hit — restituisce subito senza toccare Spotify
  const cached = getSnapshot(weekKey);
  if (cached) {
    console.log(`[SnapshotManager] Snapshot ${weekKey} trovato in cache.`);
    return { snapshot: cached, weekKey, fromCache: true };
  }

  console.log(`[SnapshotManager] Snapshot ${weekKey} non trovato, creo...`);

  // Trova o crea la playlist sorgente
  onProgress('Cerco la playlist sorgente...');
  const source = await findOrCreateRRSource();

  // Scarica tracce (non ci fidiamo di source.total — /me/playlists non lo restituisce sempre)
  onProgress('Scarico le tracce...');
  const rawTracks = await fetchAllPlaylistTracks(source.id);

  if (rawTracks.length === 0) {
    console.warn('[SnapshotManager] Nessuna traccia valida nella playlist sorgente.');
    throw new Error('RR_SOURCE_EMPTY');
  }

  // Espandi album
  onProgress('Espando gli album...');
  const snapshot = await buildSnapshot(rawTracks, source.id);

  // Salva snapshot
  saveSnapshot(weekKey, snapshot);
  console.log(`[SnapshotManager] Snapshot ${weekKey} salvato (${snapshot.items.length} items).`);

  // Svuota playlist sorgente in background (fire and forget)
  clearRRSource(source.id).catch(e =>
    console.warn('[SnapshotManager] Svuotamento sorgente fallito (non bloccante):', e.message)
  );

  return { snapshot, weekKey, fromCache: false };
}

/**
 * Forza la rigenerazione dello snapshot della settimana corrente.
 * Utile per rileggere la playlist sorgente se l'utente l'ha aggiornata.
 */
export async function forceRefreshSnapshot(onProgress = () => {}) {
  const weekKey = getCurrentWeekKey();
  console.log(`[SnapshotManager] Forzo rigenerazione snapshot ${weekKey}...`);

  onProgress('Cerco la playlist sorgente...');
  const source = await findOrCreateRRSource();

  // Scarica tracce (non ci fidiamo di source.total — /me/playlists non lo restituisce sempre)
  onProgress('Scarico le tracce...');
  const rawTracks = await fetchAllPlaylistTracks(source.id);

  if (rawTracks.length === 0) {
    throw new Error('RR_SOURCE_EMPTY');
  }

  onProgress('Espando gli album...');
  const snapshot = await buildSnapshot(rawTracks, source.id);

  saveSnapshot(weekKey, snapshot);

  clearRRSource(source.id).catch(e =>
    console.warn('[SnapshotManager] Svuotamento sorgente fallito:', e.message)
  );

  return { snapshot, weekKey, fromCache: false };
}
