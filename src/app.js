/**
 * Release Radar Expander — Entry Point
 */

import { login, handleCallback, isLoggedIn, spotifyFetch, refreshAccessToken } from './auth/auth.js';
import { getAuth, clearAuth, isTokenExpired, getAllSnapshotKeys, getSnapshot } from './auth/storage.js';
import { showToast } from './ui/toast.js';
import { loadOrCreateCurrentSnapshot, forceRefreshSnapshot } from './spotify/snapshotManager.js';
import { getCurrentWeekKey } from './spotify/expander.js';
import { writeExpandedPlaylist } from './spotify/playlistWriter.js';
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
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatTrackDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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

  document.getElementById('app').innerHTML = `
    <div class="home-screen">

      <!-- Header -->
      <div class="playlist-header">
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
      attachTrackListeners(allItems, user, snapshot, weekKey, () => currentFilter);
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

  attachTrackListeners(allItems, user, snapshot, weekKey, () => currentFilter);
}

// ---- Render: Album Detail ----

function renderAlbumDetail(albumItem, user, snapshot, weekKey, getCurrentFilter) {
  const a = albumItem.album;
  const typeLabel = a.type === 'compilation' ? 'Compilation' : a.type === 'single' ? 'EP' : 'Album';

  document.getElementById('app').innerHTML = `
    <div class="album-detail-screen">
      <div class="album-detail-topbar">
        <button class="btn-back" id="back-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="22" height="22"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
      </div>

      <div class="album-detail-cover-wrap">
        <img class="album-detail-cover" src="${a.cover || ''}" alt="${escHtml(a.name)}" onerror="this.style.background='var(--bg-elevated)'">
      </div>

      <div class="album-detail-meta">
        <h2 class="album-detail-title">${escHtml(a.name)}</h2>
        <p class="album-detail-artist">${escHtml(a.artists.map(x => x.name).join(', '))}</p>
        <p class="album-detail-info">${typeLabel} · ${a.tracks_ordered.length} tracce · ${formatDuration(a.total_duration_ms)}</p>
      </div>

      <div class="album-detail-actions">
        <button class="btn-shuffle album-shuffle" id="album-shuffle-btn" title="Shuffle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
        </button>
        <button class="btn-play-main" id="album-play-btn">
          <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
      </div>

      <div class="album-tracklist">
        ${a.tracks_ordered.map((t, idx) => `
          <div class="album-track-row">
            <span class="album-track-num">${idx + 1}</span>
            <div class="album-track-info">
              <p class="album-track-name">${escHtml(t.name)}</p>
              <p class="album-track-artist">${escHtml(t.artists.map(x => x.name).join(', '))}</p>
            </div>
            <span class="album-track-dur">${formatTrackDuration(t.duration_ms)}</span>
          </div>
        `).join('')}
      </div>

      <div class="album-detail-footer"></div>
    </div>
  `;

  // Back
  document.getElementById('back-btn').addEventListener('click', () => {
    renderHome(user, snapshot, weekKey, true);
  });

  // Play album — usa il filtro corrente della home
  document.getElementById('album-play-btn').addEventListener('click', () => {
    const filter = getCurrentFilter();
    const uris = buildExpandedUris(snapshot.items, filter);
    if (uris.length === 0) { showToast('Nessuna traccia da riprodurre.', 'error'); return; }
    handlePlay(uris, false);
  });

  // Shuffle album
  document.getElementById('album-shuffle-btn').addEventListener('click', () => {
    const filter = getCurrentFilter();
    const uris = buildExpandedUris(snapshot.items, filter);
    if (uris.length === 0) { showToast('Nessuna traccia da riprodurre.', 'error'); return; }
    handlePlay(uris, true);
  });
}

// ---- Render: Settimana senza snapshot ----

function renderEmptyWeek(user, weekKey, allKeys, currentIdx) {
  const weekLabel = formatWeekLabel(weekKey);
  document.getElementById('app').innerHTML = `
    <div class="home-screen">
      <div class="playlist-header">
        <div class="week-nav">
          <button class="week-nav-btn" id="prev-week-btn" ${currentIdx <= 0 ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="week-date">${weekLabel}</span>
          <button class="week-nav-btn" id="next-week-btn" ${currentIdx >= allKeys.length - 1 ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <h1 class="playlist-title">Release Radar</h1>
      </div>
      <div class="empty-week">
        <p class="empty-week-icon">📭</p>
        <p class="empty-week-msg">Nessuno snapshot per questa settimana.</p>
        <p class="empty-week-sub">Usa le frecce per navigare ad altre settimane.</p>
      </div>
      <div class="footer-actions">
        <button class="btn-text-sm" id="logout-btn">Esci</button>
      </div>
    </div>
  `;

  document.getElementById('logout-btn').addEventListener('click', () => {
    clearAuth();
    renderLoginScreen();
  });

  const prevBtn = document.getElementById('prev-week-btn');
  const nextBtn = document.getElementById('next-week-btn');

  if (prevBtn && !prevBtn.disabled) {
    prevBtn.addEventListener('click', () => {
      const prevKey = allKeys[currentIdx - 1];
      const prevSnap = getSnapshot(prevKey);
      if (prevSnap) renderHome(user, prevSnap, prevKey, true);
      else renderEmptyWeek(user, prevKey, allKeys, currentIdx - 1);
    });
  }
  if (nextBtn && !nextBtn.disabled) {
    nextBtn.addEventListener('click', () => {
      const nextKey = allKeys[currentIdx + 1];
      const nextSnap = getSnapshot(nextKey);
      if (nextSnap) renderHome(user, nextSnap, nextKey, true);
      else renderEmptyWeek(user, nextKey, allKeys, currentIdx + 1);
    });
  }
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

function attachTrackListeners(items, user, snapshot, weekKey, getCurrentFilter) {
  // Tap su riga album → apri album detail
  document.querySelectorAll('.album-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-more')) return;
      const idx = parseInt(row.dataset.idx, 10);
      const filtered = filterItems(items, getCurrentFilter());
      const item = filtered[idx];
      if (item && item.type === 'album_expansion') {
        renderAlbumDetail(item, user, snapshot, weekKey, getCurrentFilter);
      }
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

// ---- Play ----

let playInProgress = false;

async function handlePlay(uris, shuffle) {
  if (playInProgress) {
    showToast('Play già in corso...', 'info', 2000);
    return;
  }
  playInProgress = true;
  console.log(`[App] handlePlay: ${uris.length} URI, shuffle=${shuffle}`);

  // Mostra toast di avanzamento
  showToast('Preparo la playlist...', 'info', 30000);

  try {
    const playlistId = await writeExpandedPlaylist(uris, (msg) => {
      console.log('[App] Play progress:', msg);
      // Aggiorna il toast se ancora visibile
      const toast = document.querySelector('.toast.info');
      if (toast) toast.textContent = msg;
    });

    console.log('[App] Playlist scritta, apro Spotify:', playlistId);

    // Chiudi il toast di avanzamento
    const infoToast = document.querySelector('.toast.info');
    if (infoToast) infoToast.style.animation = 'none', infoToast.remove();

    showToast('Playlist pronta ✓', 'info', 2000);

    // Deep link Spotify — apre l'app sulla playlist
    const deepLink = `spotify:playlist:${playlistId}`;
    console.log('[App] Deep link:', deepLink);
    window.location.href = deepLink;

  } catch (e) {
    console.error('[App] Errore durante play:', e);
    const infoToast = document.querySelector('.toast.info');
    if (infoToast) infoToast.remove();

    if (e.message === 'AUTH_EXPIRED') {
      clearAuth();
      showToast('Sessione scaduta. Accedi di nuovo.', 'error', 4000);
      renderLoginScreen();
    } else {
      showToast('Errore durante la scrittura della playlist.', 'error', 4000);
    }
  } finally {
    playInProgress = false;
  }
}

// ---- Week nav ----

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
        if (prevSnap) {
          renderHome(user, prevSnap, prevKey, true);
        } else {
          renderEmptyWeek(user, prevKey, allKeys, currentIdx - 1);
        }
      }
    });
  }

  if (nextBtn) {
    nextBtn.disabled = currentIdx >= allKeys.length - 1;
    nextBtn.addEventListener('click', () => {
      if (currentIdx < allKeys.length - 1) {
        const nextKey = allKeys[currentIdx + 1];
        const nextSnap = getSnapshot(nextKey);
        if (nextSnap) {
          renderHome(user, nextSnap, nextKey, true);
        } else {
          renderEmptyWeek(user, nextKey, allKeys, currentIdx + 1);
        }
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
