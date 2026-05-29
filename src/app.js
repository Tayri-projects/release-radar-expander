/**
 * Release Radar Expander — Entry Point
 */

import { login, handleCallback, isLoggedIn, spotifyFetch, refreshAccessToken } from './auth/auth.js';
import { getAuth, clearAuth, isTokenExpired, getAllSnapshotKeys, getSnapshot, saveSnapshot } from './auth/storage.js';
import { showToast, dismissInfoToasts, updateToastMessage } from './ui/toast.js';
import { loadOrCreateCurrentSnapshot, forceRefreshSnapshot } from './spotify/snapshotManager.js';
import { getCurrentWeekKey } from './spotify/expander.js';
import { ensurePlaylistSynced, writeExpandedPlaylist } from './spotify/playlistWriter.js';
import { playWithConnect } from './spotify/player.js';
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
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0z"/>
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
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0z"/>
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
        showToast('Playlist ancora vuota. Completa il passaggio 2 su Spotify.', 'error', Infinity);
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

      <div class="playlist-actions">
        <div class="action-main-row">
          <div class="action-downloads">
            <button class="btn-action-dl" title="Scarica tutto" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Scarica Tutto</span>
            </button>
            <button class="btn-action-dl" id="dl-singles-btn" title="Solo Singoli" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Singoli</span>
            </button>
            <button class="btn-action-dl" id="dl-albums-btn" title="Solo Album" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Album</span>
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
      </div>

      <div class="filter-chips">
        <button class="chip active" data-filter="all">Tutto</button>
        <button class="chip" data-filter="singles">Solo Singoli</button>
        <button class="chip" data-filter="albums">Solo Album</button>
      </div>

      <div class="track-list" id="track-list">
        ${renderTrackList(allItems, 'all')}
      </div>

      <div class="footer-actions">
        <button class="btn-text-sm" id="logout-btn">Esci</button>
        <button class="btn-text-sm" id="refresh-btn">↺ Ricarica</button>
      </div>
    </div>
  `;

  let currentFilter = 'all';

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      currentFilter = chip.dataset.filter;
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      document.getElementById('track-list').innerHTML = renderTrackList(allItems, currentFilter);
      attachTrackListeners(allItems, user, snapshot, weekKey, () => currentFilter);
    });
  });

  document.getElementById('play-btn').addEventListener('click', () => {
    playFullExpanded(allItems, currentFilter, false);
  });

  document.getElementById('shuffle-btn').addEventListener('click', () => {
    playFullExpanded(allItems, currentFilter, true);
  });

  setupWeekNav(user, weekKey);

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

  document.getElementById('back-btn').addEventListener('click', () => {
    renderHome(user, snapshot, weekKey, true);
  });

  document.getElementById('album-play-btn').addEventListener('click', () => {
    // Punto 4: play sull'album corrente, NON sulla Release Radar mia
    console.log('[App] album-play-btn → playAlbumContext', albumItem.album.id);
    playAlbumContext(albumItem.album.id, false);
  });

  document.getElementById('album-shuffle-btn').addEventListener('click', () => {
    console.log('[App] album-shuffle-btn → playAlbumContext shuffle', albumItem.album.id);
    playAlbumContext(albumItem.album.id, true);
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

  document.querySelectorAll('.single-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-more')) return;
      const idx = parseInt(row.dataset.idx, 10);
      const filter = getCurrentFilter();
      const filtered = filterItems(items, filter);
      const item = filtered[idx];
      if (item && item.type === 'single') {
        // Punto 5: avvia la Release Radar espansa partendo da questo singolo
        console.log('[App] Tap singolo:', item.track.name, '→ playSingleFromExpanded');
        playSingleFromExpanded(items, filter, item.track.uri);
      }
    });
  });

  document.querySelectorAll('.single-row .btn-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      const filtered = filterItems(items, getCurrentFilter());
      const item = filtered[idx];
      if (item && item.type === 'single') {
        showSingleContextMenu(item, snapshot, weekKey, user, items, getCurrentFilter);
      }
    });
  });

  document.querySelectorAll('.album-row .btn-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      const filtered = filterItems(items, getCurrentFilter());
      const item = filtered[idx];
      if (item && item.type === 'album_expansion') {
        showAlbumContextMenu(item, snapshot, weekKey, user, items, getCurrentFilter);
      }
    });
  });
}

// ---- Context menu bottom sheet ----

function showSingleContextMenu(item, snapshot, weekKey, user, allItems, getCurrentFilter) {
  const track = item.track;
  const artistId = track.artists?.[0]?.id;

  dismissContextMenu();

  const sheet = document.createElement('div');
  sheet.className = 'context-sheet';
  sheet.innerHTML = `
    <div class="context-backdrop"></div>
    <div class="context-panel">
      <div class="context-track-header">
        <img class="context-thumb" src="${track.album_cover || ''}" alt="" onerror="this.style.background='var(--bg-elevated)'">
        <div class="context-track-info">
          <p class="context-track-name">${escHtml(track.name)}</p>
          <p class="context-track-artist">${escHtml(track.artists.map(a => a.name).join(', '))}</p>
        </div>
      </div>
      <div class="context-divider"></div>
      <button class="context-item" data-action="share"><span>Condividi</span></button>
      <button class="context-item" data-action="remove"><span>Rimuovi dallo snapshot</span></button>
      <button class="context-item" data-action="queue"><span>Aggiungi alla coda</span></button>
      ${artistId ? `<button class="context-item" data-action="artist"><span>Vai all'artista</span></button>` : ''}
      <button class="context-item" data-action="credits"><span>Crediti canzone</span></button>
    </div>
  `;

  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  sheet.querySelector('.context-backdrop').addEventListener('click', dismissContextMenu);

  sheet.querySelectorAll('.context-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      dismissContextMenu();

      if (action === 'share') {
        const url = `https://open.spotify.com/track/${track.id}`;
        if (navigator.share) {
          try { await navigator.share({ title: track.name, url }); } catch (_) {}
        } else {
          try { await navigator.clipboard.writeText(url); showToast('Link copiato ✓'); }
          catch (_) { showToast('Link: ' + url, 'info', 5000); }
        }
      }

      if (action === 'remove') {
        removeItemFromSnapshot(snapshot, weekKey, item);
        renderHome(user, snapshot, weekKey, true);
        showToast('Rimosso dallo snapshot ✓');
      }

      if (action === 'queue') {
        try {
          await addToQueue(track.uri);
          showToast('Aggiunto alla coda ✓', 'info', 2000);
        } catch (e) {
          console.error('[App] Errore add to queue:', e);
          if (e.message === 'SPOTIFY_API_ERROR_404') {
            showToast('Nessun dispositivo attivo. Avvia Spotify su un dispositivo e riprova.', 'error', Infinity);
          } else if (e.message === 'SPOTIFY_API_ERROR_403') {
            showToast('Permesso negato. Rieffettua il login.', 'error', Infinity);
          } else {
            showToast('Errore coda: ' + e.message, 'error', Infinity);
          }
        }
      }

      if (action === 'artist' && artistId) { window.open(`spotify:artist:${artistId}`, '_blank'); }
      // Punto 7: i singoli della Release Radar hanno isSingle=true → omette sezioni
      // ALBUM e Traccia N° nei crediti
      if (action === 'credits') { showTrackCredits(track, /*isSingle*/ true); }
    });
  });
}

function showAlbumContextMenu(item, snapshot, weekKey, user, allItems, getCurrentFilter) {
  const album = item.album;
  const artistId = album.artists?.[0]?.id;

  dismissContextMenu();

  const sheet = document.createElement('div');
  sheet.className = 'context-sheet';
  sheet.innerHTML = `
    <div class="context-backdrop"></div>
    <div class="context-panel">
      <div class="context-track-header">
        <img class="context-thumb" src="${album.cover || ''}" alt="" onerror="this.style.background='var(--bg-elevated)'">
        <div class="context-track-info">
          <p class="context-track-name">${escHtml(album.name)}</p>
          <p class="context-track-artist">${escHtml(album.artists.map(a => a.name).join(', '))}</p>
        </div>
      </div>
      <div class="context-divider"></div>
      <button class="context-item" data-action="share"><span>Condividi album</span></button>
      <button class="context-item" data-action="remove"><span>Rimuovi dallo snapshot</span></button>
      ${artistId ? `<button class="context-item" data-action="artist"><span>Vai all'artista</span></button>` : ''}
      <button class="context-item" data-action="open-album"><span>Apri album su Spotify</span></button>
    </div>
  `;

  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  sheet.querySelector('.context-backdrop').addEventListener('click', dismissContextMenu);

  sheet.querySelectorAll('.context-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      dismissContextMenu();

      if (action === 'share') {
        const url = `https://open.spotify.com/album/${album.id}`;
        if (navigator.share) {
          try { await navigator.share({ title: album.name, url }); } catch (_) {}
        } else {
          try { await navigator.clipboard.writeText(url); showToast('Link copiato ✓'); }
          catch (_) { showToast('Link: ' + url, 'info', 5000); }
        }
      }

      if (action === 'remove') {
        removeItemFromSnapshot(snapshot, weekKey, item);
        renderHome(user, snapshot, weekKey, true);
        showToast('Rimosso dallo snapshot ✓');
      }

      if (action === 'artist' && artistId) { window.open(`spotify:artist:${artistId}`, '_blank'); }
      if (action === 'open-album') { window.open(`spotify:album:${album.id}`, '_blank'); }
    });
  });
}

async function showTrackCredits(track, isSingle = false) {
  console.log(`[App] showTrackCredits: ${track.name} (isSingle=${isSingle})`);
  dismissContextMenu();

  const sheet = document.createElement('div');
  sheet.className = 'context-sheet';
  sheet.innerHTML = `
    <div class="context-backdrop"></div>
    <div class="context-panel credits-panel">
      <div class="credits-header">
        <img class="context-thumb" src="${track.album_cover || ''}" alt="" onerror="this.style.background='var(--bg-elevated)'">
        <div class="context-track-info">
          <p class="context-track-name">${escHtml(track.name)}</p>
          <p class="context-track-artist">${escHtml(track.artists.map(a => a.name).join(', '))}</p>
        </div>
      </div>
      <div class="context-divider"></div>
      <div class="credits-body" id="credits-body">
        <div class="credits-loading"><div class="spinner" style="width:20px;height:20px;border-width:2px"></div></div>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  sheet.querySelector('.context-backdrop').addEventListener('click', dismissContextMenu);

  let extraData = null;
  try {
    extraData = await spotifyFetch(`/tracks/${track.id}?market=from_token`);
    console.log('[App] Track data per crediti:', extraData);
  } catch (e) {
    console.warn('[App] Impossibile caricare dati traccia:', e.message);
  }

  const creditsBody = document.getElementById('credits-body');
  if (!creditsBody) return;

  const albumName = extraData?.album?.name || track.album_name || '—';
  const releaseDate = extraData?.album?.release_date || '—';
  const duration = formatTrackDuration(track.duration_ms);
  const trackNumber = extraData?.track_number ? `${extraData.track_number}` : '—';
  const discNumber = extraData?.disc_number > 1 ? ` · Disco ${extraData.disc_number}` : '';
  const explicit = extraData?.explicit ? '<span class="credits-tag">E</span>' : '';
  const isrc = extraData?.external_ids?.isrc || null;
  const popularity = extraData?.popularity != null ? `${extraData.popularity}/100` : null;
  const allArtists = extraData?.artists || track.artists;

  // Punto 7: per i SINGOLI omettiamo ALBUM e Traccia N° (non hanno senso).
  // Per i brani estratti da un album_expansion (isSingle=false), li manteniamo.
  const albumSection = isSingle
    ? ''
    : `<div class="credits-section"><p class="credits-label">Album</p><p class="credits-value">${escHtml(albumName)} ${explicit}</p></div>`;

  // Quando isSingle, la sezione "Traccia n°" viene rimossa: se c'è popolarità la
  // mostriamo full-width, altrimenti niente seconda riga.
  let secondRow = '';
  if (isSingle) {
    if (popularity) {
      secondRow = `<div class="credits-section"><p class="credits-label">Popolarità</p><p class="credits-value">${popularity}</p></div>`;
    }
  } else {
    secondRow = `
      <div class="credits-row">
        <div class="credits-section half"><p class="credits-label">Traccia n°</p><p class="credits-value">${trackNumber}${discNumber}</p></div>
        ${popularity ? `<div class="credits-section half"><p class="credits-label">Popolarità</p><p class="credits-value">${popularity}</p></div>` : ''}
      </div>`;
  }

  creditsBody.innerHTML = `
    <div class="credits-section">
      <p class="credits-label">Artisti</p>
      <div class="credits-artists">
        ${allArtists.map(a => `<button class="credits-artist-btn" data-artist-id="${a.id}">${escHtml(a.name)}</button>`).join('')}
      </div>
    </div>
    ${albumSection}
    <div class="credits-row">
      <div class="credits-section half"><p class="credits-label">Uscita</p><p class="credits-value">${escHtml(releaseDate)}</p></div>
      <div class="credits-section half"><p class="credits-label">Durata</p><p class="credits-value">${duration}</p></div>
    </div>
    ${secondRow}
    ${isrc ? `<div class="credits-section"><p class="credits-label">ISRC</p><p class="credits-value credits-mono">${isrc}</p></div>` : ''}
    <div class="context-divider" style="margin: 8px 0"></div>
    <button class="context-item" id="open-spotify-credits"><span>Crediti completi su Spotify</span></button>
  `;

  creditsBody.querySelectorAll('.credits-artist-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.artistId;
      if (id) window.open(`spotify:artist:${id}`, '_blank');
    });
  });

  document.getElementById('open-spotify-credits')?.addEventListener('click', () => {
    window.open(`https://open.spotify.com/track/${track.id}`, '_blank');
  });
}

function dismissContextMenu() {
  const existing = document.querySelector('.context-sheet');
  if (existing) {
    existing.classList.remove('open');
    existing.addEventListener('transitionend', () => existing.remove(), { once: true });
    setTimeout(() => existing.remove(), 400);
  }
}

function removeItemFromSnapshot(snapshot, weekKey, itemToRemove) {
  const before = snapshot.items.length;
  snapshot.items = snapshot.items.filter(i => i !== itemToRemove);
  console.log(`[App] Rimosso item da snapshot. ${before} -> ${snapshot.items.length} items`);
  saveSnapshot(weekKey, snapshot);
}

async function addToQueue(uri) {
  console.log('[App] Aggiungo alla coda:', uri);
  await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: 'POST' });
  console.log('[App] Aggiunto alla coda ✓');
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
//
// Tutte le riproduzioni passano da Connect API (PUT /me/player/play).
// Funzioni:
//   playFullExpanded(items, filter, shuffle)
//     → suona TUTTA la Release Radar espansa (usata dal play/shuffle in header)
//   playAlbumContext(albumId, shuffle)
//     → suona un album come context, senza toccare la Release Radar mia
//   playSingleFromExpanded(items, filter, targetUri)
//     → suona la Release Radar espansa partendo dal singolo cliccato (offset)
//
// Tutte gestiscono device resolution + SDK fallback dentro playWithConnect.

let playInProgress = false;

function handlePlayError(e) {
  console.error('[App] Errore durante play:', e);
  dismissInfoToasts();

  if (e.message === 'AUTH_EXPIRED') {
    clearAuth();
    showToast('Sessione scaduta. Accedi di nuovo.', 'error', Infinity);
    renderLoginScreen();
    return;
  }
  if (e.message === 'SPOTIFY_API_ERROR_403') {
    showToast('Permesso negato. Per usare il play in-app serve Spotify Premium e devi rieffettuare il login (sono cambiati gli scope).', 'error', Infinity);
    return;
  }
  if (e.message === 'SPOTIFY_API_ERROR_404') {
    showToast('Nessun dispositivo Spotify disponibile. Apri Spotify su un dispositivo o ricarica la pagina per attivare il player web.', 'error', Infinity);
    return;
  }
  if (e.message === 'SDK_ACCOUNT_ERROR') {
    showToast('Il player web richiede un account Spotify Premium.', 'error', Infinity);
    return;
  }
  if (e.message === 'SDK_INIT_TIMEOUT' || e.message?.startsWith('SDK_')) {
    showToast('Errore inizializzazione player web: ' + e.message + '. Apri Spotify su un dispositivo e riprova.', 'error', Infinity);
    return;
  }
  showToast('Errore durante la riproduzione: ' + (e.message || 'sconosciuto'), 'error', Infinity);
}

/**
 * Avvia la Release Radar espansa.
 * Garantisce che la playlist destinazione sia sincronizzata, poi avvia
 * via context_uri (così l'utente vede l'intera coda su Spotify).
 */
async function playFullExpanded(items, filter, shuffle) {
  if (playInProgress) { console.log('[App] Play già in corso, ignoro'); return; }
  playInProgress = true;

  const uris = buildExpandedUris(items, filter);
  console.log(`[App] playFullExpanded: ${uris.length} URI, filter=${filter}, shuffle=${shuffle}`);
  if (uris.length === 0) {
    showToast('Nessuna traccia da riprodurre.', 'error', Infinity);
    playInProgress = false;
    return;
  }

  const progressToast = showToast('Preparo la playlist...', 'info', Infinity);

  try {
    const { playlistId, didWrite } = await ensurePlaylistSynced(uris, (msg) => {
      console.log('[App] Sync progress:', msg);
      updateToastMessage(progressToast, msg);
    });
    if (didWrite) console.log('[App] Playlist riscritta perché non sincronizzata');
    else console.log('[App] Playlist già sincronizzata');

    updateToastMessage(progressToast, 'Avvio riproduzione...');

    await playWithConnect({
      contextUri: `spotify:playlist:${playlistId}`,
      shuffle: !!shuffle,
    });

    dismissInfoToasts();
    showToast('Playlist pronta ✓', 'info', 2000);
  } catch (e) {
    handlePlayError(e);
  } finally {
    playInProgress = false;
  }
}

/**
 * Avvia un album come context (NON tocca la Release Radar mia).
 */
async function playAlbumContext(albumId, shuffle) {
  if (playInProgress) { console.log('[App] Play già in corso, ignoro'); return; }
  playInProgress = true;
  console.log(`[App] playAlbumContext: album=${albumId}, shuffle=${shuffle}`);

  const progressToast = showToast('Avvio album...', 'info', Infinity);
  try {
    await playWithConnect({
      contextUri: `spotify:album:${albumId}`,
      shuffle: !!shuffle,
    });
    dismissInfoToasts();
    showToast('Album in riproduzione ✓', 'info', 2000);
  } catch (e) {
    handlePlayError(e);
  } finally {
    playInProgress = false;
  }
}

/**
 * Avvia la Release Radar partendo da uno specifico brano.
 * Garantisce sync della playlist destinazione, poi context_uri + offset.uri.
 */
async function playSingleFromExpanded(items, filter, targetUri) {
  if (playInProgress) { console.log('[App] Play già in corso, ignoro'); return; }
  playInProgress = true;

  const uris = buildExpandedUris(items, filter);
  console.log(`[App] playSingleFromExpanded: target=${targetUri}, totale URI=${uris.length}`);

  if (!uris.includes(targetUri)) {
    console.warn('[App] targetUri non presente nell\'espansa, fallback su play singolo');
  }

  const progressToast = showToast('Preparo la playlist...', 'info', Infinity);

  try {
    const { playlistId, didWrite } = await ensurePlaylistSynced(uris, (msg) => {
      updateToastMessage(progressToast, msg);
    });
    if (didWrite) console.log('[App] Playlist riscritta per sync');

    updateToastMessage(progressToast, 'Avvio riproduzione...');

    await playWithConnect({
      contextUri: `spotify:playlist:${playlistId}`,
      offset: { uri: targetUri },
      shuffle: false,
    });

    dismissInfoToasts();
    showToast('In riproduzione ✓', 'info', 2000);
  } catch (e) {
    handlePlayError(e);
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
    showToast('Sessione scaduta. Accedi di nuovo.', 'error', Infinity);
    renderLoginScreen();
  } else {
    showToast('Errore inaspettato. Controlla la console.', 'error', Infinity);
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
      showToast('Errore durante il login. Riprova.', 'error', Infinity);
      renderLoginScreen();
      return;
    }
  }

  if (!isLoggedIn()) { renderLoginScreen(); return; }

  if (isTokenExpired()) {
    renderLoading('Aggiornamento sessione...');
    const newToken = await refreshAccessToken();
    if (!newToken) { showToast('Sessione scaduta.', 'error', Infinity); renderLoginScreen(); return; }
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
