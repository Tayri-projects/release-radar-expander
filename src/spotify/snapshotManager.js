/**
 * snapshotManager.js — gestione lifecycle snapshot settimanale
 *
 * All'apertura della PWA:
 * 1. Calcola la week key corrente (ultimo venerdì <= oggi)
 * 2. Se lo snapshot esiste già in localStorage → lo restituisce
 * 3. Se non esiste → lo crea chiamando Spotify API e lo salva
 */

import { findReleaseRadar, fetchAllPlaylistTracks } from './releaseRadar.js';
import { buildSnapshot, getCurrentWeekKey } from './expander.js';
import { getSnapshot, saveSnapshot } from '../auth/storage.js';

/**
 * Carica lo snapshot della settimana corrente, creandolo se non esiste.
 * @param {function} onProgress - callback(message) per aggiornare la UI durante il caricamento
 * @returns {Promise<{snapshot: object, weekKey: string, fromCache: boolean}>}
 */
export async function loadOrCreateCurrentSnapshot(onProgress = () => {}) {
  const weekKey = getCurrentWeekKey();

  // Controlla cache
  const cached = getSnapshot(weekKey);
  if (cached) {
    console.log(`[SnapshotManager] Snapshot ${weekKey} trovato in cache.`);
    return { snapshot: cached, weekKey, fromCache: true };
  }

  console.log(`[SnapshotManager] Snapshot ${weekKey} non trovato, creo...`);

  // Trova Release Radar
  onProgress('Cerco la Release Radar...');
  const radarInfo = await findReleaseRadar();
  if (!radarInfo) {
    throw new Error('RELEASE_RADAR_NOT_FOUND');
  }

  // Scarica tracce
  onProgress('Scarico le tracce...');
  const rawTracks = await fetchAllPlaylistTracks(radarInfo.id);

  // Espandi
  onProgress('Espando gli album...');
  const snapshot = await buildSnapshot(rawTracks, radarInfo.id);

  // Salva
  saveSnapshot(weekKey, snapshot);
  console.log(`[SnapshotManager] Snapshot ${weekKey} creato e salvato.`);

  return { snapshot, weekKey, fromCache: false };
}

/**
 * Forza la rigenerazione dello snapshot della settimana corrente
 * (utile per il bottone debug in Fase 3).
 */
export async function forceRefreshSnapshot(onProgress = () => {}) {
  const weekKey = getCurrentWeekKey();
  console.log(`[SnapshotManager] Forzo rigenerazione snapshot ${weekKey}...`);

  onProgress('Cerco la Release Radar...');
  const radarInfo = await findReleaseRadar();
  if (!radarInfo) throw new Error('RELEASE_RADAR_NOT_FOUND');

  onProgress('Scarico le tracce...');
  const rawTracks = await fetchAllPlaylistTracks(radarInfo.id);

  onProgress('Espando gli album...');
  const snapshot = await buildSnapshot(rawTracks, radarInfo.id);

  saveSnapshot(weekKey, snapshot);
  return { snapshot, weekKey, fromCache: false };
}
