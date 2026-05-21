/**
 * Release Radar Expander — Entry Point
 */

import { login, handleCallback, isLoggedIn, spotifyFetch, refreshAccessToken } from './auth/auth.js';
import { getAuth, clearAuth, isTokenExpired, getAllSnapshotKeys, getSnapshot } from './auth/storage.js';
import { showToast } from './ui/toast.js';
import { loadOrCreateCurrentSnapshot, forceRefreshSnapshot } from './spotify/snapshotManager.js';
import { getCurrentWeekKey } from './spotify/expander.js';
import { RR_SOURCE_PLAYLIST_NAME } from './auth/config.js';

console.log('[App] Release Radar Expander avviato');

// ---- GitHub Pages SPA redirect fix ----
function restoreGitHubPagesRedirect() {
  const search = window.location.search;
  if (!search.includes('p=')) return;
  const params = new URLSearchParams(search);
  const p = params.get('p') || '';
  const q = params.get('q') || '';
  const h = params.get('h') || '';
  if (!p && !q) return;
  const newPath = window.location.pathname.replace(/\/$/, '') + p;
  const newSearch = q ? '?' + decodeURIComponent(q) : '';
  const newHash = h ? '#' + decodeURIComponent(h) : '';
  window.history.replaceState(null, '', newPath + newSearch + newHash);
  console.log('[App] GitHub Pages redirect restore:', newPath + newSearch);
}

// ---- Utilities ----

function formatDuration(totalMs) {
  const totalSec = Math.floor(totalMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function formatWeekLabel(weekKey) {
  // "2026-05-15" → "Friday, 15 May"
  const d = new Date(weekKey + 'T12:00:00');
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

function getPreviousSnapshot() {
  const currentKey = getCurrentWeekKey();
  const keys = getAllSnapshotKeys()
    .filter(k => k !== currentKey)
    .sort()
    .reverse();
  if (keys.length === 0) return null;
  return { snapshot: getSnapshot(keys[0]), weekKey: keys[0] };
}

// ---- Render: Loading ----

function renderLoading(message = 'Caricamento...') {
  document.getElementById('app').innerHTML = `
    <div class="loading-screen">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

function updateLoadingMessage(message) {
  const p = document.querySelector('.loading-screen p');
  if (p) p.textContent = message;
}

// ---- Render: Login ----

function renderLoginScreen() {
  document.getElementById('app').innerHTML = `
    <div class="login-screen">
      <div class="login-logo">
        <svg viewBox="0 0 24 24" fill="currentColor" width="64" height="64">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>
      </div>
      <h1>Release Radar Expander</h1>
      <p>Ascolta i tuoi album completi ogni venerdì.</p>
      <button class="btn-login" id="login-btn">Accedi con Spotify</button>
    </div>
  `;
  document.getElementById('login-btn').addEventListener('click', async () => {
    renderLoading('Reindirizzamento a Spotify...');
    await login();
  });
}

// ---- Render: Schermata procedura guidata ----
// Mostrata quando la playlist sorgente è vuota e non c'è snapshot corrente

function renderSetupScreen(user) {
  document.getElementById('app').innerHTML = `
    <div class="setup-screen">
      <div class="setup-header">
        <button class="btn-icon logout-btn" id="logout-btn" title="Logout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>

      <div class="setup-content">
        <div class="setup-radar-icon">
          <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48" opacity="0.3">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
        </div>

        <h2 class="setup-title">Aggiorna la Release Radar</h2>
        <p class="setup-subtitle">Ciao ${user.display_name}! Per questa settimana non ho ancora le tue uscite.</p>

        <div class="setup-steps">
          <div class="setup-step">
            <span class="step-num">1</span>
            <p>Apri la tua <strong>Release Radar</strong> su Spotify</p>
          </div>
          <div class="setup-step">
            <span class="step-num">2</span>
            <p>Seleziona tutte le tracce → <strong>Aggiungi alla playlist "${RR_SOURCE_PLAYLIST_NAME}"</strong></p>
          </div>
          <div class="setup-step">
            <span class="step-num">3</span>
            <p>Torna qui e premi <strong>Genera</strong></p>
          </div>
        </div>

        <a class="btn-spotify-open" href="spotify:playlist:37i9dQZEVXbhvRdPuaKypU" target="_blank">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Apri Release Radar su Spotify
        </a>

        <button class="btn-generate" id="generate-btn">
          Genera
        </button>
      </div>
    </div>
  `;

  document.getElementById('logout-btn').addEventListener('click', () => {
    clearAuth();
    renderLoginScreen();
  });

  document.getElementById('generate-btn').addEventListener('click', async () => {
    renderLoading('Genero lo snapshot...');
    try {
      const { snapshot, weekKey } = await forceRefreshSnapshot(updateLoadingMessage);
      renderHome(user, snapshot, weekKey, false);
      showToast('Release Radar caricata ✓');
    } catch (e) {
      if (e.message === 'RR_SOURCE_EMPTY') {
        showToast('Playlist ancora vuota. Completa il passaggio 2 su Spotify.', 'error', 4000);
        renderSetupScreen(user);
      } else {
        handleAppError(e);
      }
    }
  });
}

// ---- Render: Home principale ----

function renderHome(user, snapshot, weekKey, fromCache) {
  const allItems = snapshot.items;
  const singles = allItems.filter(i => i.type === 'single');
  const albumItems = allItems.filter(i => i.type === 'album_expansion');

  const totalMs = singles.reduce((s, i) => s + (i.track.duration_ms || 0), 0)
    + albumItems.reduce((s, i) => s + (i.album.total_duration_ms || 0), 0);

  const weekLabel = formatWeekLabel(weekKey);

  // URI per la playlist espansa (bottone play)
  // Costruita con tutti gli URI nell'ordine espanso
  const allUris = buildExpandedUris(allItems, 'all');

  document.getElementById('app').innerHTML = `
    <div class="home-screen">

      <!-- Header -->
      <div class="playlist-header">
        <div class="playlist-cover-mosaic" id="cover-mosaic">
          ${buildCoverMosaic(allItems)}
        </div>
        <div class="playlist-meta">
          <div class="week-nav">
            <button class="week-nav-btn" id="prev-week-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="week-date" id="week-date-label">${weekLabel}</span>
            <button class="week-nav-btn" id="next-week-btn" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <h1 class="playlist-title">Release Radar</h1>
          <p class="playlist-duration">${formatDuration(totalMs)}</p>
        </div>
      </div>

      <!-- Azioni -->
      <div class="playlist-actions">
        <div class="action-downloads">
          <button class="btn-action-dl" title="Scarica tutto" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Scarica Tutto</span>
          </button>
          <button class="btn-action-dl" id="dl-singles-btn" title="Solo Singoli" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Solo Singoli</span>
          </button>
          <button class="btn-action-dl" id="dl-albums-btn" title="Solo Album" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Solo Album</span>
          </button>
        </div>
        <div class="action-play-row">
          <button class="btn-shuffle" id="shuffle-btn" title="Shuffle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
          </button>
          <button class="btn-play-main" id="play-btn">
            <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
        </div>
      </div>

      <!-- Filtri -->
      <div class="filter-chips">
        <button class="chip active" data-filter="all">Tutto</button>
        <button class="chip" data-filter="singles">Solo Singoli</button>
        <button class="chip" data-filter="albums">Solo Album</button>
      </div>

      <!-- Lista -->
      <div class="track-list" id="track-list">
        ${renderTrackList(allItems, 'all')}
      </div>

      <!-- Logout nascosto in fondo -->
      <div class="footer-actions">
        <button class="btn-text-sm" id="logout-btn">Esci</button>
        <button class="btn-text-sm" id="refresh-btn">↺ Ricarica</button>
      </div>
    </div>
  `;

  // Stato filtro corrente
  let currentFilter = 'all';

  // Filtri
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      currentFilter = chip.dataset.filter;
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      document.getElementById('track-list').innerHTML = renderTrackList(allItems, currentFilter);
      attachTrackListeners(allItems);
    });
  });

  // Play
  document.getElementById('play-btn').addEventListener('click', () => {
    const uris = buildExpandedUris(allItems, currentFilter);
    if (uris.length === 0) { showToast('Nessuna traccia da riprodurre.', 'error'); return; }
    handlePlay(uris, false);
  });

  // Shuffle
  document.getElementById('shuffle-btn').addEventListener('click', () => {
    const uris = buildExpandedUris(allItems, currentFilter);
    if (uris.length === 0) { showToast('Nessuna traccia da riprodurre.', 'error'); return; }
    handlePlay(uris, true);
  });

  // Nav settimana
  setupWeekNav(user, weekKey);

  // Logout / Refresh
  document.getElementById('logout-btn').addEventListener('click', () => {
    clearAuth();
    renderLoginScreen();
  });

  document.getElementById('refresh-btn').addEventListener('click', async () => {
    renderLoading('Ricarico...');
    try {
      const { snapshot: s, weekKey: wk } = await forceRefreshSnapshot(updateLoadingMessage);
      renderHome(user, s, wk, false);
      showToast('Aggiornato ✓');
    } catch (e) {
      if (e.message === 'RR_SOURCE_EMPTY') {
        renderSetupScreen(user);
      } else {
        handleAppError(e);
      }
    }
  });

  attachTrackListeners(allItems);
}

// ---- Track list rendering ----

function renderTrackList(items, filter) {
  const filtered = filterItems(items, filter);
  if (filtered.length === 0) {
    return '<p class="empty-list">Nessuna traccia.</p>';
  }
  return filtered.map((item, idx) => {
    if (item.type === 'single') {
      return `
        <div class="track-row single-row" data-idx="${idx}">
          <img class="track-thumb" src="${item.track.album_cover || ''}" alt="" loading="lazy" onerror="this.style.background='var(--bg-elevated)'">
          <div class="track-info">
            <p class="track-name">${escHtml(item.track.name)}</p>
            <p class="track-artist">${escHtml(item.track.artists.map(a => a.name).join(', '))}</p>
          </div>
          <button class="btn-more" data-idx="${idx}" title="Opzioni">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
        </div>
      `;
    } else {
      const a = item.album;
      const typeLabel = a.type === 'compilation' ? 'Compilation' : a.type === 'single' ? 'EP' : 'Album';
      return `
        <div class="track-row album-row" data-idx="${idx}" data-album-id="${a.id}">
          <img class="track-thumb" src="${a.cover || ''}" alt="" loading="lazy" onerror="this.style.background='var(--bg-elevated)'">
          <div class="track-info">
            <p class="track-name">${escHtml(a.name)}</p>
            <p class="track-artist">${escHtml(a.artists.map(x => x.name).join(', '))}</p>
            <p class="track-meta">${typeLabel} · ${a.tracks_ordered.length} tracce · ${formatDuration(a.total_duration_ms)}</p>
          </div>
          <button class="btn-more" data-idx="${idx}" title="Opzioni">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
        </div>
      `;
    }
  }).join('');
}

function attachTrackListeners(items) {
  // Tap su riga album → espandi tracklist inline (futuro)
  document.querySelectorAll('.album-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-more')) return;
      // TODO Fase 4: toggle tracklist inline
    });
  });
}

// ---- Helpers ----

function filterItems(items, filter) {
  if (filter === 'singles') return items.filter(i => i.type === 'single');
  if (filter === 'albums') return items.filter(i => i.type === 'album_expansion');
  return items;
}

function buildExpandedUris(items, filter) {
  const filtered = filterItems(items, filter);
  const uris = [];
  for (const item of filtered) {
    if (item.type === 'single') {
      uris.push(item.track.uri);
    } else {
      for (const t of item.album.tracks_ordered) {
        uris.push(t.uri);
      }
    }
  }
  return uris;
}

function buildCoverMosaic(items) {
  // Prime 4 cover uniche
  const covers = [];
  for (const item of items) {
    const url = item.type === 'single' ? item.track.album_cover : item.album.cover;
    if (url && !covers.includes(url)) covers.push(url);
    if (covers.length >= 4) break;
  }
  if (covers.length === 0) return '';
  if (covers.length < 4) {
    return `<img src="${covers[0]}" alt="" class="mosaic-single" onerror="this.style.background='var(--bg-elevated)'">`;
  }
  return covers.map(u => `<img src="${u}" alt="" onerror="this.style.background='var(--bg-elevated)'">`).join('');
}

async function handlePlay(uris, shuffle) {
  // Fase 4: scriverà la playlist _Release Radar Espansa e aprirà Spotify
  // Per ora: deep link diretto alla playlist sorgente come placeholder
  showToast('Play — funzione in arrivo nella Fase 4', 'info', 3000);
}

function setupWeekNav(user, currentWeekKey) {
  const allKeys = getAllSnapshotKeys ? getAllSnapshotKeys().sort() : [];
  const currentIdx = allKeys.indexOf(currentWeekKey);

  const prevBtn = document.getElementById('prev-week-btn');
  const nextBtn = document.getElementById('next-week-btn');

  if (prevBtn) {
    prevBtn.disabled = currentIdx <= 0;
    prevBtn.addEventListener('click', () => {
      if (currentIdx > 0) {
        const prevKey = allKeys[currentIdx - 1];
        const prevSnap = getSnapshot(prevKey);
        if (prevSnap) renderHome(user, prevSnap, prevKey, true);
      }
    });
  }

  if (nextBtn) {
    nextBtn.disabled = currentIdx >= allKeys.length - 1;
    nextBtn.addEventListener('click', () => {
      if (currentIdx < allKeys.length - 1) {
        const nextKey = allKeys[currentIdx + 1];
        const nextSnap = getSnapshot(nextKey);
        if (nextSnap) renderHome(user, nextSnap, nextKey, true);
      }
    });
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Error handling ----

function handleAppError(e) {
  console.error('[App] Errore:', e);
  if (e.message === 'AUTH_EXPIRED') {
    clearAuth();
    showToast('Sessione scaduta. Accedi di nuovo.', 'error');
    renderLoginScreen();
  } else {
    showToast('Errore inaspettato. Controlla la console.', 'error');
    renderLoading('Errore — ricarica la pagina');
  }
}

// ---- Profilo utente ----

async function loadUserProfile() {
  try {
    return await spotifyFetch('/me');
  } catch (e) {
    if (e.message === 'AUTH_EXPIRED') { clearAuth(); return null; }
    throw e;
  }
}

// ---- Bootstrap ----

async function init() {
  await registerServiceWorker();
  restoreGitHubPagesRedirect();

  const path = window.location.pathname;
  const isCallback = path.endsWith('/callback') || path.endsWith('/callback/');

  if (isCallback || window.location.search.includes('code=')) {
    renderLoading('Completamento accesso Spotify...');
    const success = await handleCallback();
    if (!success) {
      showToast('Errore durante il login. Riprova.', 'error');
      renderLoginScreen();
      return;
    }
  }

  if (!isLoggedIn()) { renderLoginScreen(); return; }

  if (isTokenExpired()) {
    renderLoading('Aggiornamento sessione...');
    const newToken = await refreshAccessToken();
    if (!newToken) { showToast('Sessione scaduta.'); renderLoginScreen(); return; }
  }

  renderLoading('Caricamento profilo...');
  const user = await loadUserProfile();
  if (!user) { renderLoginScreen(); return; }

  renderLoading('Controllo Release Radar...');
  try {
    const { snapshot, weekKey, fromCache } = await loadOrCreateCurrentSnapshot(updateLoadingMessage);
    renderHome(user, snapshot, weekKey, fromCache);
  } catch (e) {
    if (e.message === 'RR_SOURCE_EMPTY') {
      renderSetupScreen(user);
    } else {
      handleAppError(e);
    }
  }
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      console.log('[SW] Registrato:', reg.scope);
    } catch (err) {
      console.warn('[SW] Registrazione fallita:', err);
    }
  }
}

init();
