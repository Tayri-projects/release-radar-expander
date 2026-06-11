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

export function saveAuth({ access_token, refresh_token, expires_in, scope }) {
  const data = load();
  const prev = data.auth;
  data.auth = {
    access_token,
    refresh_token,
    // expires_at: timestamp Unix in ms
    expires_at: Date.now() + (expires_in - 60) * 1000, // 60s di margine
    // scope effettivamente concesso da Spotify; preserva il precedente se il
    // refresh non lo restituisce, così sappiamo quali permessi ha il token.
    scope: scope ?? prev?.scope,
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

// ---- Ultimo device usato ----

/**
 * Legge l'ID dell'ultimo device Spotify su cui si è riprodotto con successo.
 * Usato per riprovare la riproduzione quando /me/player/devices risulta vuoto
 * (es. app Spotify in background non listata ma ancora raggiungibile via Connect).
 * @returns {string|null}
 */
export function getLastDeviceId() {
  return load().last_device_id || null;
}

/**
 * Salva l'ID dell'ultimo device funzionante. Passa null/undefined per invalidarlo.
 * @param {string|null} id
 */
export function saveLastDeviceId(id) {
  const data = load();
  if (id) {
    if (data.last_device_id === id) return; // evita scritture inutili
    data.last_device_id = id;
  } else {
    if (!data.last_device_id) return;
    delete data.last_device_id;
  }
  save(data);
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
 * Salva l'ID della playlist destinazione. Passa null per invalidarlo.
 * @param {string|null} id
 */
export function saveExpandedPlaylistId(id) {
  const data = load();
  if (id === null) {
    delete data.expanded_playlist_id;
    save(data);
    console.log('[Storage] ID playlist espansa invalidato.');
  } else {
    data.expanded_playlist_id = id;
    save(data);
    console.log('[Storage] ID playlist espansa salvato:', id);
  }
}

/**
 * Hash di sincronizzazione: l'hash degli URI scritti l'ultima volta nella
 * playlist destinazione. Confrontato con l'hash dello snapshot corrente per
 * decidere se la playlist Spotify è ancora sincronizzata.
 */
export function getExpandedPlaylistHash() {
  return load().expanded_playlist_hash || null;
}

export function saveExpandedPlaylistHash(hash) {
  const data = load();
  if (hash === null || hash === undefined) {
    delete data.expanded_playlist_hash;
    save(data);
    console.log('[Storage] Hash playlist espansa invalidato.');
  } else {
    data.expanded_playlist_hash = hash;
    save(data);
    console.log('[Storage] Hash playlist espansa salvato:', hash);
  }
}
