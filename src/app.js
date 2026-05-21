/**
 * Release Radar Expander — Entry Point
 * Fase 2: Autenticazione Spotify OAuth PKCE
 */

import { login, handleCallback, isLoggedIn, spotifyFetch, refreshAccessToken } from './auth/auth.js';
import { getAuth, clearAuth, isTokenExpired } from './auth/storage.js';
import { showToast } from './ui/toast.js';

console.log('[App] Release Radar Expander avviato — Fase 2');

// ---- Render: Loading ----

function renderLoading(message = 'Caricamento...') {
  document.getElementById('app').innerHTML = `
    <div class="loading-screen">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

// ---- Render: Login ----

function renderLoginScreen() {
  document.getElementById('app').innerHTML = `
    <div class="login-screen">
      <div class="app-icon">🎵</div>
      <h1>Release Radar Expander</h1>
      <p>Espandi i tuoi album Release Radar e ascoltali per intero ogni venerdì.</p>
      <button class="btn btn-primary" id="login-btn">
        Accedi con Spotify
      </button>
    </div>
  `;

  document.getElementById('login-btn').addEventListener('click', async () => {
    console.log('[App] Utente ha premuto Login');
    renderLoading('Reindirizzamento a Spotify...');
    await login();
  });
}

// ---- Render: Home (post-login) ----

function renderHome(user) {
  document.getElementById('app').innerHTML = `
    <div class="home-screen">
      <div class="home-header">
        <img class="user-avatar" src="${user.images?.[0]?.url || ''}" alt="${user.display_name}" onerror="this.style.display='none'">
        <div class="user-info">
          <p class="user-greeting">Ciao,</p>
          <h2 class="user-name">${user.display_name}</h2>
          <p class="user-sub">${user.product === 'premium' ? 'Spotify Premium ✓' : 'Spotify'}</p>
        </div>
        <button class="btn-icon" id="logout-btn" title="Logout">⏻</button>
      </div>

      <div class="home-placeholder">
        <p class="placeholder-text">Release Radar settimanale</p>
        <p class="placeholder-sub">La logica di espansione arriva nella Fase 3 🎵</p>
        <div class="phase-badge">Fase 2 completata</div>
      </div>
    </div>
  `;

  document.getElementById('logout-btn').addEventListener('click', () => {
    clearAuth();
    showToast('Disconnesso');
    renderLoginScreen();
  });
}

// ---- Carica profilo utente ----

async function loadUserProfile() {
  console.log('[App] Carico profilo utente da /me...');
  try {
    const user = await spotifyFetch('/me');
    console.log('[App] Profilo utente:', {
      id: user.id,
      display_name: user.display_name,
      product: user.product,
      country: user.country,
    });
    return user;
  } catch (e) {
    if (e.message === 'AUTH_EXPIRED') {
      console.warn('[App] Token scaduto definitivamente, richiedo login');
      clearAuth();
      return null;
    }
    throw e;
  }
}

// ---- Bootstrap ----

async function init() {
  await registerServiceWorker();

  // Determina il path corrente (GitHub Pages serve da /release-radar-expander/)
  const path = window.location.pathname;
  const isCallback = path.endsWith('/callback') || path.endsWith('/callback/');

  console.log('[App] Path corrente:', path, '| isCallback:', isCallback);

  // 1. Gestione callback OAuth
  if (isCallback || window.location.search.includes('code=')) {
    console.log('[App] Rilevato callback OAuth, processo...');
    renderLoading('Completamento accesso Spotify...');

    const success = await handleCallback();
    if (!success) {
      showToast('Errore durante il login. Riprova.', 'error');
      renderLoginScreen();
      return;
    }
    // Continua sotto → carica profilo
  }

  // 2. Controlla se l'utente è già loggato
  if (!isLoggedIn()) {
    console.log('[App] Utente non loggato → schermata login');
    renderLoginScreen();
    return;
  }

  // 3. Se il token è scaduto, prova a refreshare silenziosamente
  if (isTokenExpired()) {
    console.log('[App] Token scaduto, refresh silenzioso...');
    renderLoading('Aggiornamento sessione...');
    const newToken = await refreshAccessToken();
    if (!newToken) {
      console.warn('[App] Refresh fallito → login');
      showToast('Sessione scaduta. Accedi di nuovo.');
      renderLoginScreen();
      return;
    }
  }

  // 4. Carica profilo e mostra home
  renderLoading('Caricamento...');
  const user = await loadUserProfile();

  if (!user) {
    renderLoginScreen();
    return;
  }

  renderHome(user);
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const base = import.meta.env.BASE_URL;
      const reg = await navigator.serviceWorker.register(`${base}sw.js`);
      console.log('[SW] Registrato:', reg.scope);
    } catch (err) {
      console.warn('[SW] Registrazione fallita:', err);
    }
  }
}

init();
