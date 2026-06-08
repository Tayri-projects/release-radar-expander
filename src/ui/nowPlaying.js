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
 * Tap sulla barra compatta (cover o info) → espande a full-screen player.
 * Pulsante ▼ nel full player → collassa alla barra compatta.
 *
 * Tutti i controlli passano da player.js (Connect API). Premium richiesto.
 */

import {
  getPlaybackState, pausePlayback, resumePlayback, seekTo, nextTrack, previousTrack,
} from '../spotify/player.js';

const POLL_ACTIVE_MS = 3000;   // quando c'è playback attivo
const POLL_IDLE_MS = 9000;     // quando nessun device / in pausa da un po'
const EVENT_NAME = 'rr:nowplaying';

let barEl = null;
let pollTimer = null;
let lastIsPlaying = false;
let lastUri = null;
let busyControl = false; // evita doppio click sui controlli mentre l'API risponde

// Interpolazione progresso locale (aggiorna la barra senza toccare l'API)
let progressTimer = null;
let localProgressMs = 0;
let localDurationMs = 0;
let localProgressTimestamp = 0; // Date.now() dell'ultimo poll

// ---- Helper tempo ----

function formatTime(ms) {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ---- Progress interpolation ----

function startProgressInterpolation() {
  stopProgressInterpolation();
  progressTimer = setInterval(() => { // 200ms: fluido senza impatto sulle risorse
    if (!lastIsPlaying || !localDurationMs || !barEl) return;
    const elapsed = Date.now() - localProgressTimestamp;
    const estimated = Math.min(localProgressMs + elapsed, localDurationMs);
    const pct = (estimated / localDurationMs) * 100;

    // Barra compatta
    const fill = barEl.querySelector('.np-progress-fill');
    if (fill) fill.style.width = pct + '%';

    // Barra espansa
    const expFill = barEl.querySelector('.np-exp-fill');
    if (expFill) expFill.style.width = pct + '%';
    const expElapsed = barEl.querySelector('.np-exp-elapsed');
    if (expElapsed) expElapsed.textContent = formatTime(estimated);
  }, 200);
}

function stopProgressInterpolation() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
}

// ---- Icone SVG — compact ----
const ICON_PLAY  = '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
const ICON_PREV  = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="19 20 9 12 19 4 19 20"/><rect x="5" y="4" width="2.5" height="16" rx="1"/></svg>';
const ICON_NEXT  = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5 4 15 12 5 20 5 4"/><rect x="16.5" y="4" width="2.5" height="16" rx="1"/></svg>';

// ---- Icone SVG — expanded (più grandi) ----
const ICON_PLAY_LG  = '<svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
const ICON_PAUSE_LG = '<svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
const ICON_PREV_LG  = '<svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26"><polygon points="19 20 9 12 19 4 19 20"/><rect x="5" y="4" width="2.5" height="16" rx="1"/></svg>';
const ICON_NEXT_LG  = '<svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26"><polygon points="5 4 15 12 5 20 5 4"/><rect x="16.5" y="4" width="2.5" height="16" rx="1"/></svg>';

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
    <div class="np-progress-track">
      <div class="np-progress-fill"></div>
    </div>
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
    <div class="np-expanded-view">
      <div class="np-exp-header">
        <button class="np-exp-close" title="Chiudi">&#9660;</button>
        <span class="np-exp-context">In riproduzione</span>
        <div style="width:36px"></div>
      </div>
      <div class="np-exp-artwork">
        <img class="np-exp-cover" alt="" onerror="this.style.visibility='hidden'">
      </div>
      <button class="np-exp-open-spotify" title="Apri in Spotify">Apri in Spotify</button>
      <div class="np-exp-meta">
        <p class="np-exp-title"></p>
        <p class="np-exp-artist"></p>
      </div>
      <div class="np-exp-progress-wrap">
        <div class="np-exp-bar"><div class="np-exp-fill"></div></div>
        <div class="np-exp-times">
          <span class="np-exp-elapsed">0:00</span>
          <span class="np-exp-total">0:00</span>
        </div>
      </div>
      <div class="np-exp-controls">
        <button class="np-btn np-exp-prev" title="Precedente">${ICON_PREV_LG}</button>
        <button class="np-btn np-exp-playpause" title="Play/Pausa">${ICON_PLAY_LG}</button>
        <button class="np-btn np-exp-next" title="Successiva">${ICON_NEXT_LG}</button>
      </div>
    </div>
  `;
  document.body.appendChild(barEl);

  // ---- Controlli barra compatta ----
  barEl.querySelector('.np-prev').addEventListener('click', onPrev);
  barEl.querySelector('.np-next').addEventListener('click', onNext);
  barEl.querySelector('.np-playpause').addEventListener('click', onPlayPause);

  // Tap su cover / info nella barra compatta → apri full player
  barEl.querySelector('.np-cover').addEventListener('click', openFullPlayer);
  barEl.querySelector('.np-info').addEventListener('click', openFullPlayer);

  // ---- Controlli player espanso ----
  barEl.querySelector('.np-exp-prev').addEventListener('click', onPrev);
  barEl.querySelector('.np-exp-next').addEventListener('click', onNext);
  barEl.querySelector('.np-exp-playpause').addEventListener('click', onPlayPause);
  barEl.querySelector('.np-exp-close').addEventListener('click', closeFullPlayer);

  // "Apri in Spotify" nel full player
  barEl.querySelector('.np-exp-open-spotify')?.addEventListener('click', openInSpotifyApp);

  // Progress bar interattiva — seek per click o touch
  const progressWrap = barEl.querySelector('.np-exp-progress-wrap');
  progressWrap?.addEventListener('click', e => onSeekProgress(e.clientX, progressWrap));
  progressWrap?.addEventListener('touchend', e => {
    if (e.changedTouches.length) onSeekProgress(e.changedTouches[0].clientX, progressWrap);
  }, { passive: true });

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

// ---- Full player expand/collapse ----

function openFullPlayer() {
  if (!barEl || barEl.classList.contains('hidden')) return;
  console.log('[NowPlaying] apertura full player');
  barEl.classList.add('expanded');
  document.body.classList.add('np-fullscreen'); // blocca scroll sotto
}

function closeFullPlayer() {
  if (!barEl) return;
  console.log('[NowPlaying] chiusura full player');
  barEl.classList.remove('expanded');
  document.body.classList.remove('np-fullscreen');
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
    // Nessun device attivo o nessuna traccia → nascondi barra e chiudi full player
    if (!barEl.classList.contains('hidden')) {
      console.log('[NowPlaying] nessuna riproduzione → nascondo barra');
    }
    barEl.classList.add('hidden');
    closeFullPlayer();
    lastIsPlaying = false;
    lastUri = null;
    stopProgressInterpolation();
    document.body.classList.remove('has-now-playing');
    emitNowPlaying(null);
    return;
  }

  const isPlaying = !!state.is_playing;
  const uri = track.uri;
  const albumId = track.album?.id || null;

  // Cover: piccola per barra compatta, grande per player espanso
  const images = track.album?.images || [];
  const smallCover = images[images.length - 1]?.url || images[0]?.url || '';
  const largeCover = images[0]?.url || images[images.length - 1]?.url || '';

  const title = track.name || '';
  const artist = (track.artists || []).map(a => a.name).join(', ');

  barEl.classList.remove('hidden');
  document.body.classList.add('has-now-playing');

  // Aggiorna stato locale per l'interpolazione della progress bar
  if (state?.progress_ms != null && state?.item?.duration_ms) {
    localProgressMs = state.progress_ms;
    localDurationMs = state.item.duration_ms;
    localProgressTimestamp = Date.now();
    const pct = (localProgressMs / localDurationMs) * 100;

    // Barra compatta
    const fill = barEl.querySelector('.np-progress-fill');
    if (fill) fill.style.width = pct + '%';

    // Barra espansa
    const expFill = barEl.querySelector('.np-exp-fill');
    if (expFill) expFill.style.width = pct + '%';
    const expElapsed = barEl.querySelector('.np-exp-elapsed');
    if (expElapsed) expElapsed.textContent = formatTime(localProgressMs);
    const expTotal = barEl.querySelector('.np-exp-total');
    if (expTotal) expTotal.textContent = formatTime(localDurationMs);

    if (isPlaying) startProgressInterpolation();
    else stopProgressInterpolation();
  } else {
    stopProgressInterpolation();
    const fill = barEl.querySelector('.np-progress-fill');
    if (fill) fill.style.width = '0%';
    const expFill = barEl.querySelector('.np-exp-fill');
    if (expFill) expFill.style.width = '0%';
  }

  // ---- Barra compatta ----
  const coverEl = barEl.querySelector('.np-cover');
  if (coverEl.getAttribute('src') !== smallCover) {
    coverEl.style.visibility = 'visible';
    coverEl.src = smallCover;
  }
  barEl.querySelector('.np-title').textContent = title;
  barEl.querySelector('.np-artist').textContent = artist;
  barEl.querySelector('.np-playpause').innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;

  // ---- Player espanso ----
  const expCoverEl = barEl.querySelector('.np-exp-cover');
  if (expCoverEl && expCoverEl.getAttribute('src') !== largeCover) {
    expCoverEl.style.visibility = 'visible';
    expCoverEl.src = largeCover;
  }
  const expTitle = barEl.querySelector('.np-exp-title');
  if (expTitle) expTitle.textContent = title;
  const expArtist = barEl.querySelector('.np-exp-artist');
  if (expArtist) expArtist.textContent = artist;
  const expPlayPause = barEl.querySelector('.np-exp-playpause');
  if (expPlayPause) expPlayPause.innerHTML = isPlaying ? ICON_PAUSE_LG : ICON_PLAY_LG;

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

// ---- Apri in Spotify app ----

function openInSpotifyApp() {
  if (!lastUri) return;
  // lastUri è "spotify:track:xxx" — l'URI nativo apre il player Spotify senza triggerare play
  const trackId = lastUri.split(':')[2];
  console.log('[NowPlaying] apertura Spotify app, trackId:', trackId);
  window.open(`spotify:track:${trackId}`, '_blank');
}

// ---- Seek barra di progressione ----

async function onSeekProgress(clientX, wrapEl) {
  if (!localDurationMs || !wrapEl) return;
  const rect = wrapEl.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const positionMs = Math.round(ratio * localDurationMs);
  console.log(`[NowPlaying] seek → ${positionMs}ms (${Math.round(ratio * 100)}%)`);

  // Aggiorna visivamente subito — senza aspettare la risposta API
  localProgressMs = positionMs;
  localProgressTimestamp = Date.now();
  const pct = ratio * 100;
  const expFill = barEl?.querySelector('.np-exp-fill');
  if (expFill) expFill.style.width = pct + '%';
  const expElapsed = barEl?.querySelector('.np-exp-elapsed');
  if (expElapsed) expElapsed.textContent = formatTime(positionMs);

  try {
    await seekTo(positionMs);
  } catch (e) {
    console.warn('[NowPlaying] seek fallito:', e.message);
  }
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
      const expPP = barEl.querySelector('.np-exp-playpause');
      if (expPP) expPP.innerHTML = ICON_PLAY_LG;
    } else {
      await resumePlayback();
      lastIsPlaying = true;
      barEl.querySelector('.np-playpause').innerHTML = ICON_PAUSE;
      const expPP = barEl.querySelector('.np-exp-playpause');
      if (expPP) expPP.innerHTML = ICON_PAUSE_LG;
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
