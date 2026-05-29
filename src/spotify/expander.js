/**
 * expander.js — logica core di classificazione ed espansione
 *
 * Regole di classificazione (Context 3.1):
 * - album_type == "album"                        → espandi
 * - album_type == "compilation"                  → espandi
 * - album_type == "single" && total_tracks > 2   → espandi (EP camuffato)
 * - album_type == "single" && total_tracks <= 2  → singolo puro, NON espandere
 *
 * Regole di ordinamento (Context 3.2):
 * - Espansione sempre da traccia 1 a N
 * - Ordine blocchi = ordine originale Release Radar
 * - Album duplicati: espanso solo alla prima occorrenza, successive ignorate
 */

import { spotifyFetch } from '../auth/auth.js';

/**
 * Decide se una traccia va espansa o trattata come singolo puro.
 * @param {object} track - track object Spotify (con .album)
 * @returns {'single' | 'album_expansion'}
 */
export function classifyTrack(track) {
  const album = track.album;
  if (!album) return 'single';

  const type = album.album_type; // "album" | "single" | "compilation"
  const total = album.total_tracks || 1;

  if (type === 'album' || type === 'compilation') return 'album_expansion';
  if (type === 'single' && total > 2) return 'album_expansion'; // EP camuffato
  return 'single';
}

/**
 * Scarica la tracklist completa di un album.
 * @param {string} albumId
 * @returns {Promise<Array<{uri, name, track_number, duration_ms, artists}>>}
 */
export async function fetchAlbumTracks(albumId) {
  console.log(`[Expander] Scarico tracklist album: ${albumId}`);

  const tracks = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const data = await spotifyFetch(
      `/albums/${albumId}/tracks?limit=${limit}&offset=${offset}&market=from_token`
    );

    tracks.push(...data.items.map(t => ({
      uri: t.uri,
      id: t.id,
      name: t.name,
      track_number: t.track_number,
      duration_ms: t.duration_ms,
      artists: t.artists.map(a => ({ id: a.id, name: a.name })),
    })));

    if (data.next === null || offset + limit >= data.total) break;
    offset += limit;
  }

  // Ordina per track_number (dovrebbe già essere ordinato, ma garantiamo)
  tracks.sort((a, b) => a.track_number - b.track_number);
  console.log(`[Expander] Album ${albumId}: ${tracks.length} tracce`);
  return tracks;
}

/**
 * Costruisce lo snapshot completo dalla lista di tracce grezze della Release Radar.
 *
 * @param {Array} rawTracks       - tracce da fetchAllPlaylistTracks()
 * @param {string} playlistId     - ID della Release Radar
 * @returns {Promise<object>}     - snapshot secondo schema Context 2.4
 */
export async function buildSnapshot(rawTracks, playlistId) {
  console.log(`[Expander] Costruisco snapshot da ${rawTracks.length} tracce raw...`);

  const items = [];
  const seenAlbumIds = new Set(); // deduplicazione album

  // Album da espandere: raccogliamo gli ID unici per fetchare in batch
  // Prima passata: classifica e identifica album da scaricare
  const albumsToFetch = new Map(); // albumId → album object
  for (const track of rawTracks) {
    const classification = classifyTrack(track);
    if (classification === 'album_expansion' && !seenAlbumIds.has(track.album.id)) {
      albumsToFetch.set(track.album.id, track.album);
      seenAlbumIds.add(track.album.id);
    }
  }

  console.log(`[Expander] Album unici da espandere: ${albumsToFetch.size}`);

  // Scarica tutte le tracklist in parallelo (max 3 concorrenti per non stressare rate limit)
  const albumTracksCache = new Map();
  const albumIds = [...albumsToFetch.keys()];

  for (let i = 0; i < albumIds.length; i += 3) {
    const batch = albumIds.slice(i, i + 3);
    const results = await Promise.all(batch.map(id => fetchAlbumTracks(id)));
    batch.forEach((id, idx) => albumTracksCache.set(id, results[idx]));
  }

  // Reset seenAlbumIds per la seconda passata (costruzione items)
  seenAlbumIds.clear();

  // Seconda passata: costruisce items nell'ordine originale
  for (const track of rawTracks) {
    const classification = classifyTrack(track);

    if (classification === 'single') {
      items.push({
        type: 'single',
        track: {
          uri: track.uri,
          id: track.id,
          name: track.name,
          artists: track.artists.map(a => ({ id: a.id, name: a.name })),
          duration_ms: track.duration_ms,
          album_cover: track.album?.images?.[0]?.url || null,
          album_name: track.album?.name || null,
        },
      });

    } else {
      // album_expansion
      const albumId = track.album.id;

      if (seenAlbumIds.has(albumId)) {
        // Occorrenza successiva dello stesso album — soppressa
        console.log(`[Expander] Soppressa occorrenza duplicata album: ${track.album.name}`);
        continue;
      }

      seenAlbumIds.add(albumId);
      const albumObj = albumsToFetch.get(albumId);
      const tracksOrdered = albumTracksCache.get(albumId) || [];

      // Calcola durata totale album
      const totalDurationMs = tracksOrdered.reduce((sum, t) => sum + (t.duration_ms || 0), 0);

      items.push({
        type: 'album_expansion',
        source_track: {
          uri: track.uri,
          name: track.name,
          track_number: track.track_number,
        },
        album: {
          uri: albumObj.uri,
          id: albumId,
          name: albumObj.name,
          artists: albumObj.artists.map(a => ({ id: a.id, name: a.name })),
          total_tracks: albumObj.total_tracks,
          total_duration_ms: totalDurationMs,
          cover: albumObj.images?.[0]?.url || null,
          type: albumObj.album_type, // "album" | "single" (EP) | "compilation"
          release_date: albumObj.release_date || null, // item 10
          tracks_ordered: tracksOrdered,
        },
      });
    }
  }

  const snapshot = {
    captured_at: new Date().toISOString(),
    release_radar_id: playlistId,
    items,
  };

  // Log riepilogativo
  const singles = items.filter(i => i.type === 'single').length;
  const albums = items.filter(i => i.type === 'album_expansion').length;
  const totalTracks = singles + items
    .filter(i => i.type === 'album_expansion')
    .reduce((sum, i) => sum + i.album.tracks_ordered.length, 0);

  console.log(`[Expander] Snapshot costruito:`);
  console.log(`  - Singoli: ${singles}`);
  console.log(`  - Album/EP espansi: ${albums}`);
  console.log(`  - Tracce totali finali: ${totalTracks}`);
  console.log(`  - Tracce raw originali: ${rawTracks.length}`);

  return snapshot;
}

/**
 * Calcola la chiave snapshot per la settimana corrente.
 * Chiave = data dell'ultimo venerdì <= oggi (formato YYYY-MM-DD).
 * Spotify aggiorna Release Radar ogni venerdì.
 * @returns {string} es. "2026-05-15"
 */
export function getCurrentWeekKey() {
  const now = new Date();
  const day = now.getDay(); // 0=dom, 1=lun, ..., 5=ven, 6=sab
  const daysToLastFriday = (day + 2) % 7; // giorni da sottrarre per arrivare a venerdì
  const friday = new Date(now);
  friday.setDate(now.getDate() - daysToLastFriday);
  const key = friday.toISOString().split('T')[0]; // YYYY-MM-DD
  console.log(`[Expander] Week key corrente: ${key} (oggi: ${now.toISOString().split('T')[0]})`);
  return key;
}
