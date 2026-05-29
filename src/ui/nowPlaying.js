/**
 * nowPlaying.js — Barra "Now Playing" persistente in fondo allo schermo.
 *
 * Architettura (importante):
 *   - app.js fa `document.getElementById('app').innerHTML = ...` ad ogni render,
 *     quindi qualunque cosa dentro #app viene distrutta. La barra Now Playing
 *     vive come SIBLING di #app (appesa direttamente a <body>), così sopravvive
 *     a tutti i re-render.
 *   - Un poller legge GET /me/player ogni ~3s (più lento quando in pausa/idle) e:
 *       1. aggiorna la barra (cover, titolo, artista, stato play/pause)
 *       2. emette l'evento globale `rr:nowplaying` con { uri, albumId, isPlaying }
 *          così app.js può colorare di verde la riga in riproduzione e mostrare
 *          l'equalizzatore animato (3 barre).
 *
 * Tutti i controlli passano da player.js (Connect API). Premium richiesto.
 */

import {
  getPlaybackState, pausePlayback, resumePlayback, nextTrack, previousTrack,
} from '../spotify/player.js';

const POLL_ACTIVE_MS = 3000;   // quando c'è playback attivo
const POLL_IDLE_MS = 9000;     // quando nessun device / in pausa da un po'
const EVENT_NAME = 'rr:nowplaying';

let barEl = null;
let pollTimer = null;
let lastIsPlaying = false;
let lastUri = null;
let busyControl = false; // evita doppio click sui controlli mentre l'API risponde

// ---- Icone SVG ----
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="19 20 9 12 19 4 19 20"/><rect x="5" y="4" width="2.5" height="16" rx="1"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5 4 15 12 5 20 5 4"/><rect x="16.5" y="4" width="2.5" height="16" rx="1"/></svg>';

// ---- Init ----

export function initNowPlaying() {
  if (barEl) {
    console.log('[NowPlaying] già inizializzato');
    return;
  }
  console.log('[NowPlaying] init');

  barEl = document.createElement('div');
  barEl.id = 'now-playing-bar';
  barEl.className = 'now-playing-bar hidden';
  barEl.innerHTML = `
    <img class="np-cover" alt="" onerror="this.style.visibility='hidden'">
    <div class="np-info">
      <p class="np-title"></p>
      <p class="np-artist"></p>
    </div>
    <div class="np-controls">
      <button class="np-btn np-prev" title="Precedente">${ICON_PREV}</button>
      <button class="np-btn np-playpause" title="Play/Pausa">${ICON_PLAY}</button>
      <button class="np-btn np-next" title="Successiva">${ICON_NEXT}</button>
    </div>
  `;
  document.body.appendChild(barEl);

  barEl.querySelector('.np-prev').addEventListener('click', onPrev);
  barEl.querySelector('.np-next').addEventListener('click', onNext);
  barEl.querySelector('.np-playpause').addEventListener('click', onPlayPause);

  // Pausa il poller quando la tab non è visibile (risparmio API + batteria)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('[NowPlaying] tab nascosta → stop poller');
      stopPoller();
    } else {
      console.log('[NowPlaying] tab visibile → riavvio poller');
      startPoller(true);
    }
  });

  startPoller(true);
}

// ---- Poller ----

function startPoller(immediate = false) {
  stopPoller();
  if (immediate) poll();
  scheduleNext();
}

function scheduleNext() {
  const delay = lastIsPlaying ? POLL_ACTIVE_MS : POLL_IDLE_MS;
  pollTimer = setTimeout(async () => {
    await poll();
    scheduleNext();
  }, delay);
}

function stopPoller() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

/**
 * Forza un refresh immediato della barra (chiamato da app.js dopo un play).
 */
export function refreshNowPlaying() {
  console.log('[NowPlaying] refresh forzato');
  startPoller(true);
}

async function poll() {
  let state = null;
  try {
    state = await getPlaybackState();
  } catch (e) {
    console.warn('[NowPlaying] poll fallito:', e.message);
  }
  updateBar(state);
}

// ---- Update UI ----

function updateBar(state) {
  if (!barEl) return;

  const track = state?.item;
  if (!state || !track) {
    // Nessun device attivo o nessuna traccia → nascondi barra
    if (!barEl.classList.contains('hidden')) {
      console.log('[NowPlaying] nessuna riproduzione → nascondo barra');
    }
    barEl.classList.add('hidden');
    lastIsPlaying = false;
    lastUri = null;
    document.body.classList.remove('has-now-playing');
    emitNowPlaying(null);
    return;
  }

  const isPlaying = !!state.is_playing;
  const uri = track.uri;
  const albumId = track.album?.id || null;
  const cover = track.album?.images?.[track.album.images.length - 1]?.url
    || track.album?.images?.[0]?.url || '';
  const title = track.name || '';
  const artist = (track.artists || []).map(a => a.name).join(', ');

  barEl.classList.remove('hidden');
  document.body.classList.add('has-now-playing');

  const coverEl = barEl.querySelector('.np-cover');
  if (coverEl.getAttribute('src') !== cover) {
    coverEl.style.visibility = 'visible';
    coverEl.src = cover;
  }
  barEl.querySelector('.np-title').textContent = title;
  barEl.querySelector('.np-artist').textContent = artist;
  barEl.querySelector('.np-playpause').innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;

  const changed = isPlaying !== lastIsPlaying || uri !== lastUri;
  lastIsPlaying = isPlaying;
  lastUri = uri;

  if (changed) {
    console.log('[NowPlaying] stato:', { title, isPlaying, uri });
  }
  emitNowPlaying({ uri, albumId, isPlaying });
}

function emitNowPlaying(detail) {
  document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

// ---- Controlli ----

async function onPlayPause() {
  if (busyControl) return;
  busyControl = true;
  try {
    if (lastIsPlaying) {
      await pausePlayback();
      lastIsPlaying = false;
      barEl.querySelector('.np-playpause').innerHTML = ICON_PLAY;
    } else {
      await resumePlayback();
      lastIsPlaying = true;
      barEl.querySelector('.np-playpause').innerHTML = ICON_PAUSE;
    }
  } catch (e) {
    console.warn('[NowPlaying] play/pause fallito:', e.message);
  } finally {
    busyControl = false;
    // ripristina il poll veloce e riallinea con lo stato reale
    setTimeout(() => startPoller(true), 350);
  }
}

async function onNext() {
  if (busyControl) return;
  busyControl = true;
  try {
    await nextTrack();
  } catch (e) {
    console.warn('[NowPlaying] next fallito:', e.message);
  } finally {
    busyControl = false;
    setTimeout(() => startPoller(true), 500);
  }
}

async function onPrev() {
  if (busyControl) return;
  busyControl = true;
  try {
    await previousTrack();
  } catch (e) {
    console.warn('[NowPlaying] prev fallito:', e.message);
  } finally {
    busyControl = false;
    setTimeout(() => startPoller(true), 500);
  }
}
