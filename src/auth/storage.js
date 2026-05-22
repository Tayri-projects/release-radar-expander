/**
 * Storage — wrapper centralizzato per localStorage
 *
 * Tutto lo stato dell'app (auth tokens + snapshots) vive in un unico
 * oggetto JSON sotto la chiave STORAGE_KEY.
 * Struttura:
 * {
 *   auth: { access_token, refresh_token, expires_at },
 *   snapshots: { "2026-05-16": { ... }, ... }
 * }
 */

import { STORAGE_KEY } from './config.js';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('[Storage] Errore lettura localStorage:', e);
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[Storage] Errore scrittura localStorage:', e);
  }
}

// ---- Auth ----

export function getAuth() {
  return load().auth || null;
}

export function saveAuth({ access_token, refresh_token, expires_in }) {
  const data = load();
  data.auth = {
    access_token,
    refresh_token,
    // expires_at: timestamp Unix in ms
    expires_at: Date.now() + (expires_in - 60) * 1000, // 60s di margine
  };
  save(data);
  console.log('[Storage] Token salvati. Scadenza:', new Date(data.auth.expires_at).toLocaleTimeString());
}

export function clearAuth() {
  const data = load();
  delete data.auth;
  save(data);
  console.log('[Storage] Token cancellati.');
}

export function isTokenExpired() {
  const auth = getAuth();
  if (!auth || !auth.expires_at) return true;
  return Date.now() >= auth.expires_at;
}

// ---- Snapshots ----

export function getSnapshot(weekKey) {
  return load().snapshots?.[weekKey] || null;
}

export function saveSnapshot(weekKey, snapshot) {
  const data = load();
  if (!data.snapshots) data.snapshots = {};
  data.snapshots[weekKey] = snapshot;
  save(data);
  console.log('[Storage] Snapshot salvato per settimana:', weekKey);
}

export function getAllSnapshotKeys() {
  return Object.keys(load().snapshots || {}).sort().reverse();
}

// ---- Expanded Playlist ----

/**
 * Legge l'ID della playlist destinazione "_Release Radar Espansa".
 * Salvato dopo la prima creazione per evitare di ricercarla per nome ogni volta.
 * @returns {string|null}
 */
export function getExpandedPlaylistId() {
  return load().expanded_playlist_id || null;
}

/**
 * Salva l'ID della playlist destinazione.
 * @param {string} id
 */
export function saveExpandedPlaylistId(id) {
  const data = load();
  data.expanded_playlist_id = id;
  save(data);
  console.log('[Storage] ID playlist espansa salvato:', id);
}
