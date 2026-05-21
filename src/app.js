/**
 * Release Radar Expander — Entry Point
 * Fase 3: lettura Release Radar + espansione album
 */

import { login, handleCallback, isLoggedIn, spotifyFetch, refreshAccessToken } from './auth/auth.js';
import { getAuth, clearAuth, isTokenExpired } from './auth/storage.js';
import { showToast } from './ui/toast.js';
import { loadOrCreateCurrentSnapshot, forceRefreshSnapshot } from './spotify/snapshotManager.js';
import { getCurrentWeekKey } from './spotify/expander.js';

console.log('[App] Release Radar Expander avviato — Fase 3');

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

// ---- Render helpers ----

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

function renderLoginScreen() {
  document.getElementById('app').innerHTML = `
    <div class="login-screen">
      <div class="app-icon">🎵</div>
      <h1>Release Radar Expander</h1>
      <p>Espandi i tuoi album Release Radar e ascoltali per intero ogni venerdì.</p>
      <button class="btn btn-primary" id="login-btn">Accedi con Spotify</button>
    </div>
  `;
  document.getElementById('login-btn').addEventListener('click', async () => {
    renderLoading('Reindirizzamento a Spotify...');
    await login();
  });
}

// ---- Render: Home con snapshot ----

function formatDuration(totalMs) {
  const totalSec = Math.floor(totalMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function renderHome(user, snapshot, weekKey, fromCache) {
  const singles = snapshot.items.filter(i => i.type === 'single');
  const albums = snapshot.items.filter(i => i.type === 'album_expansion');
  const totalTracks = singles.length + albums.reduce((s, i) => s + i.album.tracks_ordered.length, 0);
  const totalMs = singles.reduce((s, i) => s + (i.track.duration_ms || 0), 0)
    + albums.reduce((s, i) => s + (i.album.total_duration_ms || 0), 0);

  // Formatta week key per display: "2026-05-15" → "Fri, 15 May 2026"
  const weekDate = new Date(weekKey + 'T12:00:00');
  const weekLabel = weekDate.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

  document.getElementById('app').innerHTML = `
    <div class="home-screen">
      <div class="home-header">
        <img class="user-avatar" src="${user.images?.[0]?.url || ''}" alt="${user.display_name}" onerror="this.style.display='none'">
        <div class="user-info">
          <p class="user-greeting">Ciao,</p>
          <h2 class="user-name">${user.display_name}</h2>
        </div>
        <button class="btn-icon" id="logout-btn" title="Logout">⏻</button>
      </div>

      <div class="snapshot-meta">
        <p class="week-label">📅 ${weekLabel}</p>
        <p class="snapshot-stats">
          ${singles.length} singoli · ${albums.length} album · ${totalTracks} tracce totali · ${formatDuration(totalMs)}
          ${fromCache ? ' <span class="cache-badge">cache</span>' : ' <span class="cache-badge fresh">nuovo</span>'}
        </p>
      </div>

      <div class="debug-section">
        <button class="btn btn-secondary" id="refresh-btn">🔄 Rigenera snapshot</button>
        <button class="btn btn-secondary" id="inspect-btn">🔍 Ispeziona in console</button>
      </div>

      <div class="snapshot-list" id="snapshot-list">
        ${renderSnapshotList(snapshot.items)}
      </div>
    </div>
  `;

  document.getElementById('logout-btn').addEventListener('click', () => {
    clearAuth();
    showToast('Disconnesso');
    renderLoginScreen();
  });

  document.getElementById('refresh-btn').addEventListener('click', async () => {
    renderLoading('Rigenerazione snapshot...');
    try {
      const { snapshot: newSnap, weekKey: wk } = await forceRefreshSnapshot(updateLoadingMessage);
      const updatedUser = await loadUserProfile();
      renderHome(updatedUser, newSnap, wk, false);
      showToast('Snapshot rigenerato ✓');
    } catch (e) {
      handleSnapshotError(e);
    }
  });

  document.getElementById('inspect-btn').addEventListener('click', () => {
    console.group(`[Snapshot ${weekKey}]`);
    console.log('Items totali:', snapshot.items.length);
    console.log('Singoli:', snapshot.items.filter(i => i.type === 'single').map(i => i.track.name));
    console.log('Album espansi:', snapshot.items.filter(i => i.type === 'album_expansion').map(i => ({
      album: i.album.name,
      artisti: i.album.artists.map(a => a.name).join(', '),
      tracce: i.album.total_tracks,
      tipo: i.album.type,
    })));
    console.log('Snapshot completo:', snapshot);
    console.groupEnd();
    showToast('Snapshot loggato in console ✓');
  });
}

function renderSnapshotList(items) {
  return items.map(item => {
    if (item.type === 'single') {
      return `
        <div class="track-item single-item">
          <img class="track-cover" src="${item.track.album_cover || ''}" alt="" onerror="this.style.background='var(--bg-elevated)'">
          <div class="track-info">
            <p class="track-name">${item.track.name}</p>
            <p class="track-artist">${item.track.artists.map(a => a.name).join(', ')}</p>
          </div>
          <span class="track-type-badge">singolo</span>
        </div>
      `;
    } else {
      const a = item.album;
      const dur = formatDuration(a.total_duration_ms);
      const typeLabel = a.type === 'compilation' ? 'compilation' : a.type === 'single' ? 'EP' : 'album';
      return `
        <div class="track-item album-item">
          <img class="track-cover" src="${a.cover || ''}" alt="" onerror="this.style.background='var(--bg-elevated)'">
          <div class="track-info">
            <p class="track-name">${a.name}</p>
            <p class="track-artist">${a.artists.map(x => x.name).join(', ')}</p>
            <p class="track-meta">${a.tracks_ordered.length} tracce · ${dur}</p>
          </div>
          <span class="track-type-badge album">${typeLabel}</span>
        </div>
      `;
    }
  }).join('');
}

function handleSnapshotError(e) {
  console.error('[App] Errore snapshot:', e);
  if (e.message === 'RELEASE_RADAR_NOT_FOUND') {
    showToast('Release Radar non trovata. Seguila su Spotify e riprova.', 'error', 5000);
  } else if (e.message === 'AUTH_EXPIRED') {
    clearAuth();
    showToast('Sessione scaduta. Accedi di nuovo.', 'error');
    renderLoginScreen();
  } else {
    showToast('Errore durante il caricamento. Controlla la console.', 'error');
  }
}

// ---- Carica profilo utente ----

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

  // Carica o crea snapshot
  renderLoading('Caricamento Release Radar...');
  try {
    const { snapshot, weekKey, fromCache } = await loadOrCreateCurrentSnapshot(updateLoadingMessage);
    renderHome(user, snapshot, weekKey, fromCache);
  } catch (e) {
    // Mostra comunque la home con errore, non bloccare l'utente
    renderLoading('Errore snapshot...');
    handleSnapshotError(e);
    // Mostra home senza snapshot dopo 2s
    setTimeout(() => renderHome(user, { items: [] }, getCurrentWeekKey(), false), 2000);
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
